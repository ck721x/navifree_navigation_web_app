'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as FreeMap, GeoJSONSource } from 'maplibre-gl';
import { toLngLat, type Coordinate, type Route } from '@navifree/core';

export type MapProvider = 'free' | 'mapbox';
// Keep the engine boundary limited to operations shared by both GL renderers.
type MapSurface = Pick<FreeMap, 'on' | 'remove' | 'isStyleLoaded' | 'getSource' | 'addSource' | 'addLayer' | 'setPaintProperty' | 'fitBounds' | 'setStyle' | 'easeTo' | 'zoomIn' | 'zoomOut'>;
type Props = {
  origin: Coordinate; destination: Coordinate; showDestination: boolean; route: Route | null;
  provider: MapProvider; theme: 'dark' | 'light'; pitched: boolean;
  recenter: number; north: number; onDestination: (coordinate: Coordinate) => void;
};

export function RouteMap({ origin, destination, showDestination, route, provider, theme, pitched, recenter, north, onDestination }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapSurface | null>(null);
  const onSelect = useRef(onDestination);
  const scene = useRef({ origin, destination, showDestination, route });
  const preferences = useRef({ theme, pitched });
  onSelect.current = onDestination;
  scene.current = { origin, destination, showDestination, route };
  preferences.current = { theme, pitched };
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

  function styleUrl(engine: MapProvider, mode: 'dark' | 'light') {
    return engine === 'mapbox'
      ? `mapbox://styles/mapbox/${mode === 'dark' ? 'dark-v11' : 'light-v11'}`
      : `https://tiles.openfreemap.org/styles/${mode === 'dark' ? 'dark' : 'positron'}`;
  }

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let instance: MapSurface | null = null;
    setReady(false); setError('');
    const timeout = window.setTimeout(() => { if (!disposed) setError('The map is taking longer than expected. Check your connection or retry.'); }, 20000);
    void (async () => {
      if (provider === 'mapbox' && !token) {
        setError('Mapbox needs a public token. Choose the free OpenStreetMap map in Route settings.');
        window.clearTimeout(timeout);
        return;
      }
      const options = {
        container: container.current!, style: styleUrl(provider, preferences.current.theme),
        center: toLngLat(scene.current.origin), zoom: 13,
        pitch: preferences.current.pitched ? 60 : 0, attributionControl: { compact: true },
      };
      if (provider === 'free') {
        const library = await import('maplibre-gl');
        if (disposed) return;
        library.setWorkerUrl('/map-worker.mjs');
        instance = new library.Map(options);
      } else {
        const library = await import('mapbox-gl');
        if (disposed) return;
        instance = new library.Map({ ...options, attributionControl: true, accessToken: token }) as unknown as MapSurface;
      }
      map.current = instance;
      instance.on('click', (event: { lngLat: { lat: number; lng: number } }) => onSelect.current({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }));
      instance.on('style.load', () => {
        if (disposed) return;
        window.clearTimeout(timeout); setError(''); setReady(true);
        // The source and layer setup is repeated only after a style change.
        updateScene(instance!, scene.current);
      });
      instance.on('error', () => {
        if (!disposed) setError(provider === 'mapbox' ? 'Mapbox could not load. Check the token and its URL restrictions, or switch to the free map.' : 'Some map data could not load. Check your connection or retry.');
      });
    })().catch(() => { if (!disposed) setError('The map could not start. Please retry.'); });
    return () => { disposed = true; window.clearTimeout(timeout); instance?.remove(); map.current = null; };
  }, [provider, token, retry]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !instance.isStyleLoaded()) return;
    updateScene(instance, { origin, destination, showDestination, route });
    if (route) {
      const [first] = route.geometry;
      if (!first) return;
      let west = first[0], east = first[0], south = first[1], north = first[1];
      for (const [lng, lat] of route.geometry) { west = Math.min(west, lng); east = Math.max(east, lng); south = Math.min(south, lat); north = Math.max(north, lat); }
      const compact = window.innerWidth < 640;
      instance.fitBounds([[west, south], [east, north]], { padding: compact ? { top: 150, bottom: 310, left: 35, right: 60 } : { top: 100, bottom: 90, left: 440, right: 100 }, maxZoom: 16, duration: 500 });
    }
  }, [ready, origin, destination, showDestination, route]);

  useEffect(() => { if (map.current) map.current.setStyle(styleUrl(provider, theme)); }, [provider, theme]);
  useEffect(() => { map.current?.easeTo({ pitch: pitched ? 60 : 0, duration: 450 }); }, [pitched]);
  useEffect(() => { if (recenter) map.current?.easeTo({ center: toLngLat(origin), zoom: 15, duration: 450 }); }, [recenter, origin]);
  useEffect(() => { if (north) map.current?.easeTo({ bearing: 0, duration: 450 }); }, [north]);

  return <section className="map-canvas" aria-label="Interactive navigation map">
    <div ref={container} className="map-surface" />
    {!ready && !error && <div className="map-notice" role="status"><span className="loading-ring" />Loading your map…</div>}
    {error && <div className="map-notice map-error" role="alert"><p>{error}</p><button className="secondary" onClick={() => setRetry((value) => value + 1)}>Retry map</button></div>}
    <div className="map-zoom" aria-label="Map zoom controls">
      <button aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>+</button>
      <button aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>−</button>
    </div>
  </section>;
}

function updateScene(instance: MapSurface, { origin, destination, showDestination, route }: { origin: Coordinate; destination: Coordinate; showDestination: boolean; route: Route | null }) {
  const routeData = {
    type: 'FeatureCollection' as const,
    features: route ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: route.geometry } }] : [],
  };
  const routeSource = instance.getSource('navifree-route') as GeoJSONSource | undefined;
  if (routeSource) routeSource.setData(routeData);
  else {
    instance.addSource('navifree-route', { type: 'geojson', data: routeData });
    instance.addLayer({ id: 'navifree-route-glow', type: 'line', source: 'navifree-route', paint: { 'line-color': '#3b82f6', 'line-width': 12, 'line-opacity': 0.2 } });
    instance.addLayer({ id: 'navifree-route', type: 'line', source: 'navifree-route', paint: { 'line-color': '#60a5fa', 'line-width': 5 } });
  }
  instance.setPaintProperty('navifree-route', 'line-dasharray', route?.isDemo ? [2, 2] : [1, 0]);
  const points = {
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature' as const, properties: { kind: 'origin' }, geometry: { type: 'Point' as const, coordinates: toLngLat(origin) } },
      ...(showDestination ? [{ type: 'Feature' as const, properties: { kind: 'destination' }, geometry: { type: 'Point' as const, coordinates: toLngLat(destination) } }] : []),
    ],
  };
  const pointSource = instance.getSource('navifree-points') as GeoJSONSource | undefined;
  if (pointSource) pointSource.setData(points);
  else {
    instance.addSource('navifree-points', { type: 'geojson', data: points });
    instance.addLayer({ id: 'navifree-point-halo', type: 'circle', source: 'navifree-points', paint: { 'circle-radius': 13, 'circle-color': ['match', ['get', 'kind'], 'origin', '#3b82f6', '#f87171'], 'circle-opacity': 0.22 } });
    instance.addLayer({ id: 'navifree-point', type: 'circle', source: 'navifree-points', paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'kind'], 'origin', '#3b82f6', '#f87171'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  }
}
