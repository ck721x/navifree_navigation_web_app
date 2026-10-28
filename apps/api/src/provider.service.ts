import { BadGatewayException, BadRequestException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createDemoRoute, routeSchema, type Place, type Route, type RouteRequest } from '@navifree/core';
import { z } from 'zod';

const upstreamRouteSchema = z.object({
  routes: z.array(z.object({
    geometry: z.object({ type: z.literal('LineString'), coordinates: routeSchema.shape.geometry }),
    distance: z.number().finite().nonnegative(),
    duration: z.number().finite().nonnegative(),
    legs: z.array(z.object({
      steps: z.array(z.object({
        distance: z.number().finite().nonnegative(),
        name: z.string().optional(),
        maneuver: z.object({ type: z.string(), modifier: z.string().optional(), instruction: z.string().optional() }),
      })),
      notifications: z.array(z.object({ type: z.string().optional(), subtype: z.string().optional() })).optional(),
    })),
    notifications: z.array(z.object({ type: z.string().optional(), subtype: z.string().optional() })).optional(),
  })).min(1),
});

const searchResultSchema = z.array(z.object({
  place_id: z.union([z.number(), z.string()]), display_name: z.string(), lat: z.string(), lon: z.string(),
}));

// This process-wide gate deliberately rejects excess work rather than creating an unbounded queue.
export class PublicServiceGate {
  private nextAllowedAt = 0;
  private busy = false;
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy || Date.now() < this.nextAllowedAt) throw new HttpException('Public service is busy. Wait a moment before trying again.', 429);
    this.busy = true;
    this.nextAllowedAt = Date.now() + 1100;
    try { return await work(); } finally { this.busy = false; }
  }
}

@Injectable()
export class ProviderService {
  private readonly searchGate = new PublicServiceGate();
  private readonly routeGate = new PublicServiceGate();
  private readonly searches = new Map<string, { expires: number; places: Place[] }>();

  capabilities() {
    return {
      publicApisEnabled: process.env.ENABLE_PUBLIC_APIS === 'true',
      mapboxRoutingEnabled: process.env.ENABLE_MAPBOX_ROUTING === 'true' && Boolean(process.env.MAPBOX_API_TOKEN),
      assistant: 'local-rules' as const,
    };
  }

  private assertPublicServices() {
    if (!this.capabilities().publicApisEnabled) throw new ServiceUnavailableException('Public prototype services are disabled. Demo mode works without external APIs.');
    if (!process.env.PROVIDER_USER_AGENT || process.env.PROVIDER_USER_AGENT.includes('local development')) {
      throw new ServiceUnavailableException('Set an identifying PROVIDER_USER_AGENT with your project URL or contact before enabling public services.');
    }
  }

  private endpoint(value: string | undefined, fallback: string) {
    const endpoint = new URL(value || fallback);
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new ServiceUnavailableException('Invalid provider endpoint configuration.');
    if (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(endpoint.hostname)) throw new ServiceUnavailableException('Provider endpoints must use HTTPS.');
    return endpoint.toString().replace(/\/$/, '');
  }

  private async json(url: string) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': process.env.PROVIDER_USER_AGENT || 'NaviFree/0.1', Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('upstream');
      return await response.json();
    } catch {
      // Never return upstream URLs: they can contain coordinates or a provider token.
      throw new BadGatewayException('The external provider is unavailable. Please try later or use Demo mode.');
    }
  }

  async search(query: string): Promise<Place[]> {
    this.assertPublicServices();
    const key = query.toLowerCase();
    const cached = this.searches.get(key);
    if (cached && cached.expires > Date.now()) return cached.places;
    return this.searchGate.run(async () => {
      const base = this.endpoint(process.env.NOMINATIM_BASE_URL, 'https://nominatim.openstreetmap.org');
      const url = new URL(`${base}/search`);
      url.search = new URLSearchParams({ q: query, format: 'json', limit: '5' }).toString();
      const parsed = searchResultSchema.safeParse(await this.json(url.toString()));
      if (!parsed.success) throw new BadGatewayException('The search provider returned an invalid response.');
      const places = parsed.data.flatMap((item) => {
        const coordinate = { latitude: Number(item.lat), longitude: Number(item.lon) };
        const valid = Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude) && Math.abs(coordinate.latitude) <= 90 && Math.abs(coordinate.longitude) <= 180;
        return valid ? [{ id: String(item.place_id), name: item.display_name, coordinate }] : [];
      });
      if (this.searches.size >= 100) this.searches.delete(this.searches.keys().next().value!);
      this.searches.set(key, { expires: Date.now() + 3600000, places });
      return places;
    });
  }

  async route(request: RouteRequest): Promise<Route> {
    if (request.provider === 'demo') return createDemoRoute(request);
    if (request.provider === 'osrm') {
      this.assertPublicServices();
      if (request.avoidTolls) throw new BadRequestException('OSRM public prototype routing does not support toll avoidance.');
    } else if (!this.capabilities().mapboxRoutingEnabled) {
      throw new ServiceUnavailableException('Mapbox routing is disabled. It requires an explicit opt-in and a server token.');
    }
    return this.routeGate.run(async () => {
      const coords = `${request.origin.longitude},${request.origin.latitude};${request.destination.longitude},${request.destination.latitude}`;
      const base = request.provider === 'mapbox'
        ? 'https://api.mapbox.com/directions/v5/mapbox/driving'
        : `${this.endpoint(process.env.OSRM_BASE_URL, 'https://router.project-osrm.org')}/route/v1/driving`;
      const url = new URL(`${base}/${coords}`);
      url.searchParams.set('overview', 'full');
      url.searchParams.set('geometries', 'geojson');
      url.searchParams.set('steps', 'true');
      if (request.provider === 'mapbox') {
        url.searchParams.set('access_token', process.env.MAPBOX_API_TOKEN!);
        if (request.avoidTolls) url.searchParams.set('exclude', 'toll');
      }
      const parsed = upstreamRouteSchema.safeParse(await this.json(url.toString()));
      if (!parsed.success) throw new BadGatewayException('No usable road route was returned. Choose another destination.');
      const route = parsed.data.routes[0]!;
      const notifications = [...(route.notifications || []), ...route.legs.flatMap((leg) => leg.notifications || [])];
      const warnings = ['Route preview only. Live traffic, speed limits, and turn-by-turn tracking are unavailable.'];
      if (request.provider === 'osrm') warnings.push('Shared public demo service: no availability guarantee and no toll avoidance.');
      if (request.avoidTolls) warnings.push('Toll avoidance was requested; it is not a guarantee. Check the provider warnings.');
      for (const note of notifications) warnings.push(`Provider warning: ${note.type || 'notice'} ${note.subtype || ''}`.trim());
      return routeSchema.parse({
        provider: request.provider,
        geometry: route.geometry.coordinates,
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        steps: route.legs.flatMap((leg) => leg.steps.map((step) => ({
          distanceMeters: step.distance,
          instruction: step.maneuver.instruction || `${step.maneuver.type.replaceAll('_', ' ')}${step.maneuver.modifier ? ` ${step.maneuver.modifier}` : ''}${step.name ? ` onto ${step.name}` : ''}`,
        }))),
        warnings,
        isDemo: false,
      });
    });
  }
}
