'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createApiClient } from '@navifree/api-client';
import { coordinateSchema, createDemoRoute, distanceMeters, isUsableLocation, type Capabilities, type Coordinate, type Place, type Route, type RouteRequest } from '@navifree/core';


const api = createApiClient(process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001');
const initialOrigin = { latitude: '3.1390', longitude: '101.6869' };
const initialDestination = { latitude: '3.2379', longitude: '101.6840' };

function parseCoordinate(value: { latitude: string; longitude: string }): Coordinate | null {
  if (!value.latitude.trim() || !value.longitude.trim()) return null;
  const parsed = coordinateSchema.safeParse({ latitude: Number(value.latitude), longitude: Number(value.longitude) });
  return parsed.success ? parsed.data : null;
}

export function usePlanner() {
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const [originLabel, setOriginLabel] = useState('Sample origin · Kuala Lumpur');
  const [provider, setProvider] = useState<RouteRequest['provider']>('demo');
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [apiStatus, setApiStatus] = useState('Checking optional API…');
  const [route, setRoute] = useState<Route | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState('Location is requested only when you choose “Use my location”.');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('I can explain route previews and feature availability. This assistant runs locally and does not use an LLM.');
  const routeRequest = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const searchRevision = useRef(0);
  const locationRevision = useRef(0);

  useEffect(() => {
    let disposed = false;
    api.capabilities().then((value) => {
      if (!disposed) { setCapabilities(value); setApiStatus('API connected'); }
    }).catch(() => { if (!disposed) setApiStatus('API unavailable · local demo still works'); });
    return () => { disposed = true; routeRequest.current?.abort(); searchRequest.current?.abort(); locationRevision.current++; };
  }, []);

  function invalidateRoute() {
    revision.current++;
    routeRequest.current?.abort();
    setRoute(null); setBusy(false); setError('');
  }

  function selectDestination(coordinate: Coordinate) {
    invalidateRoute();
    searchRevision.current++;
    searchRequest.current?.abort();
    setSearching(false);
    setSearchStatus('');
    setDestination({ latitude: coordinate.latitude.toFixed(6), longitude: coordinate.longitude.toFixed(6) });
    setPlaces([]);
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    const start = parseCoordinate(origin), end = parseCoordinate(destination);
    invalidateRoute();
    if (!start || !end) { setError('Enter valid coordinates: latitude −90 to 90, longitude −180 to 180.'); return; }
    if (distanceMeters(start, end) < 10) { setError('Choose a destination at least 10 metres from the origin.'); return; }
    const current = revision.current;
    const controller = new AbortController();
    routeRequest.current = controller;
    setBusy(true);
    const request = { origin: start, destination: end, provider, avoidTolls };
    try {
      const result = provider === 'demo' ? createDemoRoute(request) : await api.route(request, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
      if (revision.current === current) setRoute(result);
    } catch (failure) {
      if (revision.current === current) setError(failure instanceof Error ? failure.message : 'Route calculation failed.');
    } finally { if (revision.current === current) setBusy(false); }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    searchRequest.current?.abort();
    const current = ++searchRevision.current;
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true); setSearchStatus(''); setPlaces([]);
    try {
      const results = await api.search(query.trim(), AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
      if (searchRevision.current === current) {
        setPlaces(results); setSearchStatus(results.length ? `${results.length} places found. Choose a destination below.` : 'No places found. Try a more specific name or enter coordinates.');
      }
    } catch (failure) { if (searchRevision.current === current) setSearchStatus(failure instanceof Error ? failure.message : 'Search is unavailable.'); }
    finally { if (searchRevision.current === current) setSearching(false); }
  }

  function locate() {
    if (!navigator.geolocation) { setLocationStatus('Location is unavailable. Enter an origin manually.'); return; }
    const current = ++locationRevision.current;
    setLocating(true); setLocationStatus('Requesting your location…');
    navigator.geolocation.getCurrentPosition((position) => {
      if (current !== locationRevision.current) return;
      setLocating(false);
      if (!isUsableLocation(position.coords.accuracy, position.timestamp)) {
        setLocationStatus('The location is old or too imprecise. Try again or enter an origin manually.'); return;
      }
      invalidateRoute();
      setOrigin({ latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) });
      setOriginLabel('Your location · one-time snapshot');
      setLocationStatus(`Location captured within about ${Math.round(position.coords.accuracy)} m. It is not continuously tracked.`);
    }, (failure) => {
      if (current !== locationRevision.current) return;
      setLocating(false);
      setLocationStatus(failure.code === 1 ? 'Location permission denied. Enter an origin manually.' : 'Location is unavailable. Try again or enter an origin manually.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }

  const start = useMemo(() => parseCoordinate(origin), [origin]);
  const end = useMemo(() => parseCoordinate(destination), [destination]);

  function editCoordinate(kind: 'origin' | 'destination', key: 'latitude' | 'longitude', value: string) {
    invalidateRoute();
    if (kind === 'origin') {
      locationRevision.current++; setLocating(false); setOriginLabel('Manually entered origin');
      setOrigin((current) => ({ ...current, [key]: value }));
    } else setDestination((current) => ({ ...current, [key]: value }));
  }
  function editQuery(value: string) {
    searchRevision.current++; searchRequest.current?.abort(); setSearching(false); setPlaces([]); setSearchStatus(''); setQuery(value);
  }
  return {
    origin, destination, originLabel, provider, setProvider, avoidTolls, setAvoidTolls, capabilities, apiStatus,
    route, error, busy, query, places, searching, searchStatus, locating, locationStatus,
    question, setQuestion, answer, setAnswer, start, end,
    invalidateRoute, selectDestination, calculate, search, locate, editCoordinate, editQuery,
  };
}
