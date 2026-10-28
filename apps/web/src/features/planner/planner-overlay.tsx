'use client';

import { useEffect, useRef, useState } from 'react';
import { getLocalAdvice, type Coordinate, type RouteRequest } from '@navifree/core';
import { Icon } from '../../components/icon';
import { RouteMap, type MapProvider } from '../map/route-map';
import { usePlanner } from './use-planner';

const sampleOrigin = { latitude: 3.139, longitude: 101.6869 };
const sampleDestination = { latitude: 3.2379, longitude: 101.684 };

export function Planner() {
  const model = usePlanner();
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [pitched, setPitched] = useState(false);
  const [voice, setVoice] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const [north, setNorth] = useState(0);
  const [mapProvider, setMapProvider] = useState<MapProvider>('free');
  const [destinationTitle, setDestinationTitle] = useState('Plan your journey');
  const [notice, setNotice] = useState('');
  const [messages, setMessages] = useState([{ sender: 'assistant', text: 'Hello! I’m your NaviFree travel copilot. I can explain your route and available features. I run locally, so there are no AI charges.' }]);
  const assistantInput = useRef<HTMLInputElement>(null);
  const assistantTrigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const mapboxConfigured = Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('navifree_theme');
      if (saved === 'light' || saved === 'dark') setTheme(saved);
      setVoice(localStorage.getItem('navifree_voice') === 'true');
    } catch { /* Settings are optional when browser storage is blocked. */ }
    return () => window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setSearchOpen(false);
      if (assistantOpen) { setAssistantOpen(false); assistantTrigger.current?.focus(); }
      else setPlannerOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assistantOpen]);

  useEffect(() => { if (assistantOpen) assistantInput.current?.focus(); }, [assistantOpen]);
  useEffect(() => { if (assistantOpen) chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages, assistantOpen]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('navifree_theme', next); } catch { /* Optional preference. */ }
  }
  function toggleVoice() {
    setVoice(!voice);
    if (voice) window.speechSynthesis?.cancel();
    setNotice(voice ? 'Voice announcements off' : 'Voice announcements on · route guidance is not available yet');
    try { localStorage.setItem('navifree_voice', String(!voice)); } catch { /* Optional preference. */ }
  }
  function speak(text: string) {
    if (!('speechSynthesis' in window)) { setNotice('Speech is not supported by this browser.'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en';
    window.speechSynthesis.speak(utterance);
  }
  function ask(text: string) {
    const question = text.trim();
    if (!question) return;
    const answer = getLocalAdvice(question, model.route);
    setMessages((current) => [...current.slice(-38), { sender: 'user', text: question }, { sender: 'assistant', text: answer }]);
    model.setQuestion('');
    if (voice) speak(answer);
  }
  function select(coordinate: Coordinate, name = 'Selected map location') {
    model.selectDestination(coordinate);
    setDestinationTitle(name); setPlannerOpen(true); setCollapsed(false); setSearchOpen(false);
  }
  function closeRoute() {
    model.invalidateRoute(); setPlannerOpen(false); setCollapsed(false); setDestinationTitle('Plan your journey');
  }

  return <main className={`navigation-app ${theme === 'light' ? 'light-map' : ''}`}>
    <h1 className="sr-only">NaviFree navigation and route planner</h1>
    <RouteMap origin={model.start || sampleOrigin} destination={model.end || sampleDestination} showDestination={plannerOpen} route={model.route}
      provider={mapProvider} theme={theme} pitched={pitched} recenter={recenter} north={north} onDestination={select} />

    <div className="search-stack">
      <div className="search-row">
        <form className="search-bar floating-panel" onSubmit={(event) => {
          event.preventDefault(); setSearchOpen(true);
          if (model.capabilities?.publicApisEnabled) void model.search(event);
        }}>
          <button type="submit" className="search-submit" aria-label="Search destinations"><Icon name="search" /></button>
          <label htmlFor="place-search" className="sr-only">Search destination, street, or POI</label>
          <input id="place-search" ref={searchInput} placeholder="Search destination, street, or POI..." value={model.query} minLength={3} maxLength={150} required autoComplete="off" onChange={(event) => { model.editQuery(event.target.value); setSearchOpen(false); }} />
          <span className="country-badge" title="Default map region: Malaysia. Your location has not been inferred.">MY</span>
          {model.query && <button type="button" className="icon-button small" aria-label="Clear destination search" onClick={() => { model.editQuery(''); setSearchOpen(false); searchInput.current?.focus(); }}><Icon name="close" /></button>}
        </form>
        <button className="copilot-trigger" ref={assistantTrigger} aria-label="AI Copilot" aria-expanded={assistantOpen} aria-controls="assistant-drawer" onClick={() => { setAssistantOpen(!assistantOpen); setSearchOpen(false); }}><Icon name="sparkles" /><span>AI Copilot</span></button>
      </div>
      {searchOpen && <section className="search-results floating-panel" aria-label="Destination search results">
        <div className="popover-heading"><span>Destination search</span><button className="icon-button small" aria-label="Close search results" onClick={() => setSearchOpen(false)}><Icon name="close" /></button></div>
        {!model.capabilities?.publicApisEnabled ? <div className="empty-search"><p>Place search is not connected yet. You can select a destination on the map or enter coordinates.</p><button className="secondary" onClick={() => { setPlannerOpen(true); setCollapsed(false); setSearchOpen(false); }}>Enter coordinates</button></div> : <>
          <p role="status" className="search-feedback">{model.searching ? 'Searching…' : model.searchStatus}</p>
          <ul>{model.places.map((place) => <li key={place.id}><button className="place-result" onClick={() => select(place.coordinate, place.name)}><Icon name="pin" /><span>{place.name}</span></button></li>)}</ul>
          <a className="search-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        </>}
      </section>}
    </div>

    <nav className="map-controls" aria-label="Map controls">
      <button className="map-control blue" title="Center on my location" aria-label="Center on my location" disabled={model.locating} onClick={() => { setRecenter((value) => value + 1); model.locate(); setNotice('Requesting a one-time GPS location.'); }}><Icon name="locate" /></button>
      <button className={`map-control cyan ${pitched ? 'active' : ''}`} title="Toggle 3D view" aria-label="Toggle 3D view" aria-pressed={pitched} onClick={() => setPitched(!pitched)}><Icon name="cube" /></button>
      <button className="map-control amber" title="Toggle map theme" aria-label="Toggle map theme" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      <button className="map-control purple" title="Toggle voice announcements" aria-label="Toggle voice announcements" aria-pressed={voice} onClick={toggleVoice}><Icon name={voice ? 'volume' : 'mute'} /></button>
      <button className="map-control rose" title="Reset map to north" aria-label="Reset map to north" onClick={() => setNorth((value) => value + 1)}><Icon name="north" /></button>
      <button className={`map-control slate ${plannerOpen ? 'active' : ''}`} title="Open route planner" aria-label="Open route planner" aria-expanded={plannerOpen} aria-controls="route-card" onClick={() => { setPlannerOpen(!plannerOpen); setCollapsed(false); }}><Icon name="route" /></button>
    </nav>

    <div className={`speed-widget floating-panel ${plannerOpen ? 'above-route' : ''}`} title="Live speed and road speed limits are unavailable. No speed is inferred.">
      <div><strong>—</strong><span>KM/H</span></div><i /><span className="speed-limit" aria-label="Speed limit unavailable">—</span>
    </div>

    {plannerOpen && <section id="route-card" className={`route-card floating-panel ${collapsed ? 'collapsed' : ''}`} aria-label="Route planner">
      <header className="route-header"><span className="destination-icon"><Icon name="pin" /></span><div><h2>{destinationTitle}</h2><p>{model.route ? 'Route preview · no live guidance' : 'Choose a destination and plan a route'}</p></div><button className="icon-button small" aria-label={collapsed ? 'Expand route planner' : 'Collapse route planner'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><Icon name="chevron" style={{ transform: collapsed ? 'rotate(180deg)' : undefined }} /></button><button className="icon-button small" aria-label="Close route planner" onClick={closeRoute}><Icon name="close" /></button></header>
      {!collapsed && <div className="route-scroll">
        <div className="route-options"><button className={!model.avoidTolls ? 'selected' : ''} onClick={() => { model.invalidateRoute(); model.setAvoidTolls(false); }}><Icon name="bolt" />Standard route</button><button disabled={model.provider !== 'mapbox'} className={model.avoidTolls ? 'selected' : ''} title={model.provider !== 'mapbox' ? 'Requires optional Mapbox routing' : 'Request toll avoidance; not guaranteed'} onClick={() => { model.invalidateRoute(); model.setAvoidTolls(true); }}><Icon name="shield" />Avoid tolls</button></div>
        <div className="route-summary" aria-live="polite"><div><strong>{model.route?.durationSeconds == null ? '— min' : `${Math.ceil(model.route.durationSeconds / 60)} min`}</strong><span>{model.route?.distanceMeters == null ? '— km' : `${(model.route.distanceMeters / 1000).toFixed(1)} km`}</span></div><p>{model.busy ? 'Calculating route…' : model.route?.isDemo ? 'Demo line · not a road route' : model.route ? 'Provider estimate · live traffic unavailable' : 'Ready to plan your journey'}</p></div>
        {model.route && <ul className="route-warnings">{model.route.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <form onSubmit={model.calculate} className="route-form">
          <details open={!model.route}><summary><Icon name="settings" />Route settings</summary>
            <div className="settings-content">
              <label>Map display<select className="field" value={mapProvider} onChange={(event) => setMapProvider(event.target.value as MapProvider)}><option value="free">OpenStreetMap · free, no key</option><option value="mapbox" disabled={!mapboxConfigured}>Mapbox · {mapboxConfigured ? 'optional, metered' : 'token not configured'}</option></select></label>
              <label>Routing service<select className="field" value={model.provider} onChange={(event) => { model.invalidateRoute(); model.setProvider(event.target.value as RouteRequest['provider']); model.setAvoidTolls(false); }}><option value="demo">Local demo · no routing requests</option><option value="osrm" disabled={!model.capabilities?.publicApisEnabled}>OSRM · free public prototype</option><option value="mapbox" disabled={!model.capabilities?.mapboxRoutingEnabled}>Mapbox · optional, metered</option></select></label>
              <fieldset><legend>Origin</legend><p className="coordinate-note">{model.originLabel}</p><div className="coordinate-fields">{(['latitude', 'longitude'] as const).map((key) => <label key={key}>{key}<input className="field" type="number" step="any" required min={key === 'latitude' ? -90 : -180} max={key === 'latitude' ? 90 : 180} value={model.origin[key]} onChange={(event) => model.editCoordinate('origin', key, event.target.value)} /></label>)}</div></fieldset>
              <button className="secondary location-button" type="button" disabled={model.locating} onClick={model.locate}><Icon name="locate" />{model.locating ? 'Locating…' : 'Use my location'}</button>
              <p role="status" className="coordinate-note">{model.locationStatus}</p>
              <fieldset><legend>Destination</legend><div className="coordinate-fields">{(['latitude', 'longitude'] as const).map((key) => <label key={key}>{key}<input className="field" type="number" step="any" required min={key === 'latitude' ? -90 : -180} max={key === 'latitude' ? 90 : 180} value={model.destination[key]} onChange={(event) => model.editCoordinate('destination', key, event.target.value)} /></label>)}</div></fieldset>
              <p className="coordinate-note">{model.provider === 'demo' ? 'Demo draws a line only. No ETA or road distance is invented.' : 'Calculating shares these coordinates with the selected routing service.'}</p>
            </div>
          </details>
          {model.error && <p className="inline-error" role="alert">{model.error}</p>}
          <button className="primary calculate-button" disabled={model.busy}><Icon name="route" />{model.busy ? 'Calculating…' : model.provider === 'demo' ? 'Preview demo route' : 'Calculate route'}</button>
        </form>
        {model.route && model.route.steps.length > 0 && <details className="route-steps"><summary>Turn-by-turn instructions ({model.route.steps.length})</summary><ol>{model.route.steps.map((step, index) => <li key={index}>{step.instruction}<small>{Math.round(step.distanceMeters)} m</small></li>)}</ol></details>}
      </div>}
    </section>}

    {assistantOpen && <aside id="assistant-drawer" role="dialog" aria-label="NaviFree AI Copilot" aria-modal="false" className="assistant-drawer floating-panel">
      <header className="assistant-header"><span className="assistant-avatar"><Icon name="sparkles" /></span><div><h2>NaviFree Assistant <span>LOCAL</span></h2><p>Your free travel copilot · no LLM</p></div><button className="icon-button small" aria-label="Close AI Copilot" onClick={() => { setAssistantOpen(false); assistantTrigger.current?.focus(); }}><Icon name="close" /></button></header>
      <div className="chat-messages" role="log" aria-label="Conversation" aria-live="polite">{messages.map((message, index) => <div key={index} className={`chat-message ${message.sender}`}><p>{message.text}</p>{message.sender === 'assistant' && <button onClick={() => speak(message.text)} aria-label="Listen to assistant message"><Icon name="volume" />Listen</button>}</div>)}<div ref={chatEnd} /></div>
      <div className="chat-chips">{['☕ Coffee stops', 'Avoid tolls?', 'Explain my route'].map((text) => <button key={text} onClick={() => ask(text)}>{text}</button>)}</div>
      <form className="chat-form" onSubmit={(event) => { event.preventDefault(); ask(model.question); }}><label className="sr-only" htmlFor="assistant-question">Ask NaviFree</label><input id="assistant-question" ref={assistantInput} placeholder="Ask NaviFree…" value={model.question} onChange={(event) => model.setQuestion(event.target.value)} maxLength={500} required /><button className="chat-send" aria-label="Send message"><Icon name="send" /></button></form>
    </aside>}

    <div className="map-status"><span className="status-dot" /><span>{mapProvider === 'free' ? 'OpenStreetMap · free map' : 'Mapbox'}</span><span className="status-divider">·</span><span title={model.apiStatus}>{model.capabilities ? 'Route preview' : 'Local preview'}</span></div>
    <div className="sr-only" role="status">{model.locationStatus}</div>
    {notice && <div className="map-toast floating-panel" role="status">{notice}</div>}
  </main>;
}
