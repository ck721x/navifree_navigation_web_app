const { copyFileSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

// Serve the installed, lockfile-pinned worker locally. No CDN version mismatch.
const source = require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs');
const target = join(__dirname, '../public/map-worker.mjs');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
