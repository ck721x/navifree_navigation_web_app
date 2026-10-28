const { test } = require('node:test');
const assert = require('node:assert/strict');
const { coordinateSchema, routeRequestSchema, createDemoRoute, distanceMeters, getLocalAdvice, isUsableLocation, toLngLat } = require('@navifree/core');

const origin = { latitude: 3.139, longitude: 101.6869 };
const destination = { latitude: 3.2379, longitude: 101.684 };

test('coordinates reject out-of-range, non-finite, and string values', () => {
  for (const value of [{ latitude: 91, longitude: 10 }, { latitude: 2, longitude: 181 }, { latitude: NaN, longitude: 10 }, { latitude: '3', longitude: 10 }]) {
    assert.equal(coordinateSchema.safeParse(value).success, false);
  }
  assert.deepEqual(toLngLat(origin), [101.6869, 3.139]);
});

test('demo preview never invents road distance, duration, steps, or traffic', () => {
  const request = routeRequestSchema.parse({ origin, destination });
  const route = createDemoRoute(request);
  assert.equal(route.isDemo, true);
  assert.equal(route.distanceMeters, null);
  assert.equal(route.durationSeconds, null);
  assert.deepEqual(route.steps, []);
  assert.deepEqual(route.geometry, [[101.6869, 3.139], [101.684, 3.2379]]);
  assert.match(route.warnings[0], /not a road route/);
});

test('distance calculation uses coordinates in the right order', () => {
  assert.equal(distanceMeters(origin, origin), 0);
  assert.ok(distanceMeters(origin, destination) > 10900 && distanceMeters(origin, destination) < 11100);
});

test('location validation rejects old, future, inaccurate, and invalid samples', () => {
  assert.equal(isUsableLocation(20, 95000, 100000), true);
  assert.equal(isUsableLocation(150, 95000, 100000), false);
  assert.equal(isUsableLocation(10, 70000, 100000), false);
  assert.equal(isUsableLocation(10, 120000, 100000), false);
  assert.equal(isUsableLocation(-1, 95000, 100000), false);
});

test('assistant acknowledges missing data rather than inventing POIs or toll prices', () => {
  assert.match(getLocalAdvice('coffee nearby', null), /not connected/);
  assert.match(getLocalAdvice('toll price', null), /not available/);
  assert.match(getLocalAdvice('traffic now', null), /not connected/);
  assert.match(getLocalAdvice('explain', createDemoRoute({ origin, destination })), /straight-line/);
});
