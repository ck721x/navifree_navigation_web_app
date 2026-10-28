import { capabilitiesSchema, placesSchema, routeSchema, adviceSchema, type RouteRequest, type Route } from '@navifree/core';

export function createApiClient(baseUrl: string) {
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : 'The service is unavailable. Please try again.');
    return data;
  }
  return {
    capabilities: async () => capabilitiesSchema.parse(await request('/v1/capabilities')),
    search: async (query: string, signal?: AbortSignal) => placesSchema.parse(await request(`/v1/places/search?q=${encodeURIComponent(query)}`, { signal })),
    route: async (body: RouteRequest, signal?: AbortSignal) => routeSchema.parse(await request('/v1/routes', { method: 'POST', body: JSON.stringify(body), signal })),
    advice: async (question: string, route: Route | null) => adviceSchema.parse(await request('/v1/recommendations', { method: 'POST', body: JSON.stringify({ question, route }) })),
  };
}
