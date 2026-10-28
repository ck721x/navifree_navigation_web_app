import { z } from 'zod';

export const coordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
export type Coordinate = z.infer<typeof coordinateSchema>;
export const providerSchema = z.enum(['demo', 'osrm', 'mapbox']);
export const routeRequestSchema = z.object({
  origin: coordinateSchema,
  destination: coordinateSchema,
  provider: providerSchema.default('demo'),
  avoidTolls: z.boolean().default(false),
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;
export const stepSchema = z.object({
  instruction: z.string(),
  distanceMeters: z.number().nonnegative(),
});
export const routeSchema = z.object({
  provider: providerSchema,
  geometry: z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2),
  distanceMeters: z.number().nonnegative().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  steps: z.array(stepSchema),
  warnings: z.array(z.string()),
  isDemo: z.boolean(),
});
export type Route = z.infer<typeof routeSchema>;
export const placeSchema = z.object({ id: z.string(), name: z.string(), coordinate: coordinateSchema });
export const placesSchema = z.array(placeSchema);
export type Place = z.infer<typeof placeSchema>;
export const capabilitiesSchema = z.object({
  publicApisEnabled: z.boolean(),
  mapboxRoutingEnabled: z.boolean(),
  assistant: z.literal('local-rules'),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export const adviceRequestSchema = z.object({
  question: z.string().trim().min(1).max(500),
  route: routeSchema.nullable().default(null),
});
export const adviceSchema = z.object({ answer: z.string(), source: z.literal('local-rules') });

export function toLngLat(coordinate: Coordinate): [number, number] {
  return [coordinate.longitude, coordinate.latitude];
}

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180;
  const deltaLat = (b.latitude - a.latitude) * radians;
  const deltaLng = (b.longitude - a.longitude) * radians;
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(deltaLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(value)));
}

export function createDemoRoute(request: RouteRequest): Route {
  return {
    provider: 'demo',
    geometry: [toLngLat(request.origin), toLngLat(request.destination)],
    distanceMeters: null,
    durationSeconds: null,
    steps: [],
    warnings: ['Demo only: this straight line is not a road route. No travel time, traffic, or toll information is available.'],
    isDemo: true,
  };
}

export function getLocalAdvice(question: string, route: Route | null): string {
  const text = question.toLowerCase();
  if (/toll|tol\b/.test(text)) return 'Toll prices are not available. OSRM demo routing cannot exclude tolls. Optional Mapbox routing can request toll avoidance, but its warnings must still be checked.';
  if (/coffee|cafe|restaurant|sight|nearby|poi|kopi/.test(text)) return 'Verified nearby POIs are not connected yet. Use the destination search to look up a specific place by name. I will not invent nearby businesses or opening hours.';
  if (/traffic|congestion|speed|limit|trafik/.test(text)) return 'Live traffic and reliable road speed limits are not connected. Route estimates are not evidence of current traffic or a legal speed limit.';
  if (!route || route.isDemo || route.distanceMeters === null || route.durationSeconds === null) return 'Choose an origin and destination, then calculate a route. Demo mode makes no external requests and draws only a straight-line preview. Enable public prototype services for an actual road route.';
  return `The route is ${(route.distanceMeters / 1000).toFixed(1)} km with a provider estimate of ${Math.ceil(route.durationSeconds / 60)} minutes. This is a route preview, not live turn-by-turn guidance. ${route.warnings.join(' ')}`;
}

export function isUsableLocation(accuracy: number, timestamp: number, now = Date.now()): boolean {
  return Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100 && timestamp <= now + 5000 && now - timestamp <= 15000;
}
