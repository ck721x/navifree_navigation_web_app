const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
process.env.NODE_ENV = 'test';
process.env.ENABLE_PUBLIC_APIS = 'false';
process.env.ENABLE_MAPBOX_ROUTING = 'false';
const { createApp } = require('../apps/api/dist/main');
let app, base;

before(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => { await app?.close(); });

async function post(path, body) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('HTTP API reports its disabled external integrations and security headers', async () => {
  const response = await fetch(`${base}/v1/capabilities`, { headers: { Origin: 'http://localhost:3000' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.deepEqual(await response.json(), { publicApisEnabled: false, mapboxRoutingEnabled: false, assistant: 'local-rules' });
});

test('HTTP route validation rejects unsafe inputs without echoing payloads', async () => {
  const response = await post('/v1/routes', { origin: { latitude: 200, longitude: 100 }, destination: { latitude: 3, longitude: 101 }, apiKey: 'do-not-echo' });
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /do-not-echo/);
});

test('HTTP demo works without credentials and refuses fake toll avoidance', async () => {
  const body = { origin: { latitude: 3.139, longitude: 101.6869 }, destination: { latitude: 3.2379, longitude: 101.684 } };
  const response = await post('/v1/routes', body);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).distanceMeters, null);
  assert.equal((await post('/v1/routes', { ...body, avoidTolls: true })).status, 400);
  assert.equal((await post('/v1/routes', { ...body, provider: 'osrm' })).status, 503);
});

test('HTTP assistant is bounded and refuses to invent prices', async () => {
  const response = await post('/v1/recommendations', { question: 'toll prices' });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.source, 'local-rules');
  assert.match(result.answer, /not available/);
  assert.equal((await post('/v1/recommendations', { question: 'x'.repeat(501) })).status, 400);
});

test('malformed and oversized JSON receive safe client errors', async () => {
  const invalid = await fetch(`${base}/v1/routes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{secret' });
  assert.equal(invalid.status, 400);
  assert.doesNotMatch(await invalid.text(), /secret/);
  const oversized = await post('/v1/routes', { payload: 'x'.repeat(270000) });
  assert.equal(oversized.status, 413);
});
