# NaviFree

A free-first route-planning MVP using **Next.js, React, TypeScript, Tailwind CSS, and NestJS**. The default map uses open-source MapLibre with OpenStreetMap data hosted by OpenFreeMap; Mapbox remains optional. No database, authentication, paid AI, or cloud subscription is required for local development.

## Run locally

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The API runs at [http://localhost:3001/health](http://localhost:3001/health). No environment files are required for the default demo.

The original full-screen map layout is restored: floating destination search and AI Copilot, right-side controls, a compact speed display, and an on-demand route card. The default map loads automatically without a key. The assistant uses local rules and does not call an LLM.

Click the map to select a destination, or use the **Open route planner** control on the right. The default routing mode draws a **straight demo line**, not a road route, and deliberately has no ETA or road distance. Real road routing remains an optional public prototype integration. Live speed, speed limits, traffic, and guidance are unavailable; unknown values show “—”. GPS is requested only on demand, and the initial blue point is a sample origin in Kuala Lumpur.

The free map contacts OpenFreeMap for styles, fonts and tiles. This exposes the viewport and normal request metadata to the tile provider, but creates no subscription or metered Mapbox usage. There are no automatic search, road-routing, analytics, or LLM requests. MapLibre’s lockfile-matched worker is served locally by a preparation script before development and production builds, avoiding worker/CDN version mismatches.

`index.html` is now a launch guide. The earlier single-file prototype is available in Git history; its fabricated toll/traffic behavior and ungrounded AI requests are not included in the new app.

## Optional free public prototype APIs

Copy `apps/api/.env.example` to `apps/api/.env`, then set:

```dotenv
ENABLE_PUBLIC_APIS=true
PROVIDER_USER_AGENT=NaviFree/0.1 (https://YOUR-PROJECT-URL-OR-CONTACT)
```

Replace the identifying value with your actual project URL or contact, then restart the API. The interface will enable:

- **Nominatim search:** explicit form submission only, never autocomplete. Results are cached for one hour in a bounded process-local cache. Search is globally limited to one in-flight request and at least 1.1 seconds between request starts.
- **OSRM demo routing:** choose this provider and calculate once to request an actual road route. Estimates are preserved exactly, all route legs are normalized, and no toll-avoidance or traffic capability is claimed.

These are donated/shared public resources, **not unlimited free production infrastructure**. Run only one API instance with public services enabled. Rate limiting and caching are process-local and reset on restart. Do not deploy multiple instances against the public endpoints, run load tests against them, prefetch in the background, or use them as a production availability guarantee. Check policy before public deployment. If unsuitable, disable them; the local demo still works.

You can change `NOMINATIM_BASE_URL` and `OSRM_BASE_URL` through server configuration without changing clients. Only operators control these URLs; request bodies cannot supply arbitrary upstream destinations. The public Nominatim endpoint has a whole-application limit of 1 request/second and prohibits autocomplete. The gate deliberately leaves a margin. Restarting the application does not grant a fresh public-service allowance: wait before resuming calls and avoid rapid restarts with public services enabled.

Search submits the entered query to Nominatim; road routing submits the selected coordinates to the selected provider. No automatic IP geolocation or location-history storage exists. Search data attribution is displayed in the app.

Policies: [Nominatim](https://operations.osmfoundation.org/policies/nominatim/), [OSRM demo server](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server), [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).

## Optional Mapbox

Mapbox remains available alongside the free map. It is **metered**, so it is disabled by default; this project does not promise that using Mapbox will always be free.

1. Copy `apps/web/.env.example` to `apps/web/.env.local`.
2. Set `NEXT_PUBLIC_MAPBOX_TOKEN` to a dedicated **public `pk.` token**, with minimal scopes and URL restrictions. Never put secret-scope tokens in frontend variables.
3. Restart the web app. Open the route planner, then choose **Mapbox** under **Route settings → Map display**. Merely configuring the token does not initialize a Mapbox map. Map clicks choose a destination with either renderer.
4. For optional Mapbox road routing, separately configure `MAPBOX_API_TOKEN` and `ENABLE_MAPBOX_ROUTING=true` in the API environment. A server token alone does not enable it.

Mapbox routing uses `driving`, not traffic-aware routing. Toll avoidance is available only with this provider, passes `exclude=toll`, and displays provider notifications and a non-guarantee warning. No estimates are inflated or invented. Search results do not come from Mapbox and are not permanently stored. Validate coverage and licensing before expanding POI features.

Monitor your [Mapbox usage and pricing](https://www.mapbox.com/pricing). Budget alerts are not hard spending caps, and a public token is visible in the browser. Leave Mapbox unconfigured if your requirement is absolutely no possibility of provider charges.

## Development checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Tests use fixtures and a local HTTP API, never live providers. CI uses the same checks with external integrations disabled. Shared package changes require `npm run build:shared` or restarting `npm run dev`. API and frontend changes are watched during development.

## Structure

```text
apps/web          Next.js App Router, full-screen map UI, free map and optional Mapbox
apps/api          NestJS validation, bounded provider adapters and HTTP API
packages/core     Runtime contracts, coordinates, local assistant logic
packages/api-client  Validated HTTP client reusable by React Native
tests             Domain, mocked provider, and local HTTP regression tests
docs              Architecture, zero-cost operations and expansion decisions
```

GPS is requested once by an explicit button; no background watcher runs. Samples older than 15 seconds or less precise than 100 m are rejected. A location snapshot is not continuously updated. Closing the page ends application work. Search and route requests have timeouts, cancellation and latest-result checks. Coordinates remain in memory and are not persisted.

## Free hosting, when ready

Local development is the guaranteed zero-hosting-cost path. No accounts or cloud resources are created by the repository.

- **Web:** Vercel Hobby for the current personal, noncommercial project. Import this npm workspace repository with `apps/web` as the project root, use root-level workspace installation, and build shared packages before the web workspace. Example build command from the repository root: `npm run build:shared && npm run build -w @navifree/web`. Ensure the host includes files outside the web root. Set `NEXT_PUBLIC_API_BASE_URL` to the API URL, not localhost, and rebuild.
- **API:** Render Free, Node 24, repository root as the working directory. Build: `npm ci && npm run build:shared && npm run build -w @navifree/api`. Start: `npm run start -w @navifree/api`. Set `ALLOWED_ORIGINS` to the deployed frontend origin. Leave optional providers disabled until policies and identification are configured. Render sets `PORT` automatically.
- Free Render services sleep on inactivity. The app's local demo and local assistant continue to work while the API is unavailable. A live route request may need to be retried after the service starts.
- There is no deployment workflow containing credentials: CI validates changes, and hosting setup is manual until a provider account and deployment target are chosen. Enable provider deployments only after CI passes.
- No uptime pings, permanent staging services, database, Redis, external logging, analytics SDK, or paid subscriptions are provisioned.

Check current terms: [Vercel](https://vercel.com/pricing), [Render](https://render.com/docs/free). Free tiers can change and are not an availability guarantee. Render Free PostgreSQL is time-limited and should not be used for durable user data.

See [architecture and next milestones](docs/architecture.md). Do not expose a production navigation service based solely on this preview MVP.

Free map documentation: [OpenFreeMap](https://openfreemap.org/), [MapLibre](https://maplibre.org/), [OpenStreetMap attribution](https://www.openstreetmap.org/copyright). The shared map service needs an internet connection and is not an availability guarantee. Required data attribution remains visible on the map.
