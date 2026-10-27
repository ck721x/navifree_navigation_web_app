import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = fileURLToPath(new URL('.', import.meta.url));
loadEnvironment(join(appDirectory, '.env'));

const config = {
  port: Number(process.env.PORT || 3000),
  geocoderBaseUrl: trimTrailingSlash(process.env.GEOCODER_BASE_URL),
  routerBaseUrl: trimTrailingSlash(process.env.ROUTER_BASE_URL),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  upstreamUserAgent: process.env.UPSTREAM_USER_AGENT || 'NaviFree/1.0'
};

const responseCache = new Map();
const rateLimits = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;
const JSON_LIMIT_BYTES = 24_000;

function loadEnvironment(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

function trimTrailingSlash(value) {
  return value ? value.replace(/\/+$/, '') : '';
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } });
}

function getClientAddress(request) {
  return request.socket.remoteAddress || 'unknown';
}

function applyRateLimit(request, response) {
  const key = getClientAddress(request);
  const now = Date.now();
  const entry = rateLimits.get(key) || { startedAt: now, count: 0 };
  if (now - entry.startedAt >= WINDOW_MS) {
    entry.startedAt = now;
    entry.count = 0;
  }
  entry.count += 1;
  rateLimits.set(key, entry);
  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    sendError(response, 429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.');
    return false;
  }
  return true;
}

function getCached(key) {
  const entry = responseCache.get(key);
  if (!entry || Date.now() - entry.createdAt > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheValue(key, value) {
  responseCache.set(key, { createdAt: Date.now(), value });
  if (responseCache.size > 300) responseCache.delete(responseCache.keys().next().value);
}

async function readJson(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text, 'utf8') > JSON_LIMIT_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

function requireProvider(response, providerUrl, providerName) {
  if (providerUrl) return true;
  sendError(response, 503, 'PROVIDER_NOT_CONFIGURED', `${providerName} has not been configured by this deployment.`);
  return false;
}

function assertCoordinatePair(value) {
  return Array.isArray(value)
    && value.length === 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && Math.abs(value[0]) <= 180
    && Math.abs(value[1]) <= 90;
}

async function fetchUpstream(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': config.upstreamUserAgent,
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const error = new Error(`Upstream service returned ${response.status}.`);
      error.status = 502;
      throw error;
    }
    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Upstream service timed out.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleGeocode(requestUrl, response) {
  if (!requireProvider(response, config.geocoderBaseUrl, 'Geocoding')) return;
  const query = (requestUrl.searchParams.get('q') || '').trim();
  const country = (requestUrl.searchParams.get('country') || '').trim().toLowerCase();
  if (query.length < 2 || query.length > 120) {
    return sendError(response, 400, 'INVALID_QUERY', 'Enter between 2 and 120 characters to search.');
  }
  if (country && !/^[a-z]{2}$/.test(country)) {
    return sendError(response, 400, 'INVALID_COUNTRY', 'Country must be a two-letter country code.');
  }

  const cacheKey = `geocode:${country}:${query.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return sendJson(response, 200, cached);

  const upstream = new URL(`${config.geocoderBaseUrl}/search`);
  upstream.searchParams.set('format', 'jsonv2');
  upstream.searchParams.set('q', query);
  upstream.searchParams.set('limit', '6');
  if (country) upstream.searchParams.set('countrycodes', country);

  const data = await fetchUpstream(upstream);
  const results = Array.isArray(data) ? data.slice(0, 6).map((item) => ({
    id: String(item.place_id || item.osm_id || `${item.lat},${item.lon}`),
    name: String(item.name || item.display_name || 'Unnamed location').split(',')[0],
    address: String(item.display_name || item.name || 'Location'),
    lat: Number(item.lat),
    lon: Number(item.lon)
  })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon)) : [];

  const body = { results };
  cacheValue(cacheKey, body);
  sendJson(response, 200, body);
}

async function handleRoute(request, response) {
  if (!requireProvider(response, config.routerBaseUrl, 'Routing')) return;
  const body = await readJson(request);
  const profileMap = { car: 'driving', motorcycle: 'driving', bicycle: 'cycling', foot: 'walking' };
  const profile = profileMap[body.profile] || 'driving';
  const waypoints = Array.isArray(body.waypoints) ? body.waypoints : [];
  if (waypoints.length < 2 || waypoints.length > 8 || !waypoints.every(assertCoordinatePair)) {
    return sendError(response, 400, 'INVALID_WAYPOINTS', 'Provide 2 to 8 valid [longitude, latitude] waypoints.');
  }

  const coordinatePath = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const upstream = new URL(`${config.routerBaseUrl}/route/v1/${profile}/${coordinatePath}`);
  upstream.searchParams.set('overview', 'full');
  upstream.searchParams.set('geometries', 'geojson');
  upstream.searchParams.set('steps', 'true');
  upstream.searchParams.set('alternatives', 'true');

  const data = await fetchUpstream(upstream);
  if (!Array.isArray(data.routes) || data.routes.length === 0) {
    return sendError(response, 502, 'NO_ROUTE', 'The routing provider did not return a route.');
  }
  sendJson(response, 200, {
    routes: data.routes.slice(0, 2),
    source: 'configured-routing-provider'
  });
}

async function handleAssistant(request, response) {
  if (!requireProvider(response, config.geminiApiKey, 'AI Copilot')) return;
  const body = await readJson(request);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 1_500) : '';
  if (!prompt) return sendError(response, 400, 'INVALID_PROMPT', 'Enter a message for NaviFree Copilot.');

  const context = typeof body.context === 'string' ? body.context.slice(0, 700) : 'No location was shared.';
  const upstream = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`);
  upstream.searchParams.set('key', config.geminiApiKey);
  const payload = {
    systemInstruction: {
      parts: [{ text: 'You are NaviFree Copilot. Give concise, practical navigation guidance. Never claim live traffic, verified toll prices, or legal speed-limit advice unless explicit provider data is included. If context is approximate, say so.' }]
    },
    contents: [{ parts: [{ text: `Context: ${context}\n\nUser request: ${prompt}` }] }]
  };
  const data = await fetchUpstream(upstream, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const message = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(' ').trim();
  sendJson(response, 200, { message: message || 'I could not create a response right now. Please try again.' });
}

function serveIndex(response) {
  const filePath = join(appDirectory, 'index.html');
  response.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
  createReadStream(filePath).pipe(response);
}

function securityHeaders(headers) {
  return {
    ...headers,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), microphone=(), camera=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com",
      "connect-src 'self' https://*.basemaps.cartocdn.com",
      "worker-src 'self' blob:",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  };
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (!applyRateLimit(request, response)) return;

  try {
    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
      return sendJson(response, 200, {
        ok: true,
        providers: {
          geocoder: Boolean(config.geocoderBaseUrl),
          router: Boolean(config.routerBaseUrl),
          ai: Boolean(config.geminiApiKey)
        }
      });
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/geocode') return await handleGeocode(requestUrl, response);
    if (request.method === 'POST' && requestUrl.pathname === '/api/route') return await handleRoute(request, response);
    if (request.method === 'POST' && requestUrl.pathname === '/api/assistant') return await handleAssistant(request, response);
    if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')) return serveIndex(response);
    return sendError(response, 404, 'NOT_FOUND', 'Route not found.');
  } catch (error) {
    console.error(error);
    return sendError(response, error.status || 500, 'REQUEST_FAILED', error.message || 'Unexpected server error.');
  }
});

server.listen(config.port, () => {
  console.log(`NaviFree is running at http://localhost:${config.port}`);
});
