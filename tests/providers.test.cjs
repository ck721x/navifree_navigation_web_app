const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { ProviderService, PublicServiceGate } = require('../apps/api/dist/provider.service');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
afterEach(() => { global.fetch = originalFetch; process.env = { ...originalEnv }; });
const request = {
  origin: { latitude: 3.139, longitude: 101.6869 },
  destination: { latitude: 3.2379, longitude: 101.684 },
  provider: 'osrm', avoidTolls: false,
};

function enablePublicApis() {
  process.env.ENABLE_PUBLIC_APIS = 'true';
  process.env.PROVIDER_USER_AGENT = 'NaviFree-test/0.1 (https://example.com/navifree)';
}

const fixture = { routes: [{
  geometry: { type: 'LineString', coordinates: [[101.6869, 3.139], [101.684, 3.2379]] }, distance: 12543, duration: 876,
  legs: [
    { steps: [{ distance: 100, name: '<img src=x onerror=alert(1)>', maneuver: { type: 'turn', modifier: 'left' } }] },
    { steps: [{ distance: 200, maneuver: { type: 'arrive', instruction: 'Arrive' } }] },
  ],
}] };

test('default demo and local assistant cannot trigger provider calls', async () => {
  delete process.env.ENABLE_PUBLIC_APIS;
  delete process.env.ENABLE_MAPBOX_ROUTING;
  global.fetch = () => { throw new Error('Unexpected network access'); };
  const service = new ProviderService();
  assert.equal((await service.route({ ...request, provider: 'demo' })).isDemo, true);
  await assert.rejects(service.route(request), /disabled/);
  await assert.rejects(service.search('Kuala Lumpur'), /disabled/);
  await assert.rejects(service.route({ ...request, provider: 'mapbox' }), /disabled/);
});

test('route adapter preserves actual estimates and includes all legs', async () => {
  enablePublicApis();
  global.fetch = async (url) => {
    assert.match(url, /101.6869,3.139;101.684,3.2379/);
    return { ok: true, json: async () => fixture };
  };
  const route = await new ProviderService().route(request);
  assert.equal(route.distanceMeters, 12543);
  assert.equal(route.durationSeconds, 876);
  assert.equal(route.steps.length, 2);
  assert.match(route.steps[0].instruction, /turn left onto <img/);
  assert.equal(route.steps[1].instruction, 'Arrive');
});

test('unsupported toll avoidance and malformed provider responses fail explicitly', async () => {
  enablePublicApis();
  const service = new ProviderService();
  await assert.rejects(service.route({ ...request, avoidTolls: true }), /does not support toll avoidance/);
  global.fetch = async () => ({ ok: true, json: async () => ({ routes: [] }) });
  await assert.rejects(service.route(request), /No usable road route/);
});

test('Mapbox is opt-in and toll violations are exposed', async () => {
  process.env.ENABLE_MAPBOX_ROUTING = 'true';
  process.env.MAPBOX_API_TOKEN = 'test-token';
  global.fetch = async (url) => {
    assert.equal(new URL(url).searchParams.get('exclude'), 'toll');
    return { ok: true, json: async () => ({ routes: [{ ...fixture.routes[0], notifications: [{ type: 'violation', subtype: 'toll' }] }] }) };
  };
  const route = await new ProviderService().route({ ...request, provider: 'mapbox', avoidTolls: true });
  assert.ok(route.warnings.some((warning) => /violation toll/.test(warning)));
});

test('search is cached and public-service concurrency is bounded', async () => {
  enablePublicApis();
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => [{ place_id: 1, display_name: '<script>unsafe</script>', lat: '3.1', lon: '101.6' }] }; };
  const service = new ProviderService();
  const result = await service.search('Kuala Lumpur');
  assert.equal(result[0].name, '<script>unsafe</script>');
  await service.search('kuala lumpur');
  assert.equal(calls, 1);
  await assert.rejects(service.search('Batu Caves'), /busy/);
  const gate = new PublicServiceGate();
  let release;
  const first = gate.run(() => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(gate.run(async () => 2), /busy/);
  release(1);
  assert.equal(await first, 1);
});

test('provider failures do not expose credentials or coordinates', async () => {
  enablePublicApis();
  global.fetch = async () => { throw new Error('https://provider.test?key=secret&coordinates=private'); };
  await assert.rejects(new ProviderService().route(request), (error) => {
    assert.doesNotMatch(error.message, /secret|private/);
    return true;
  });
});
