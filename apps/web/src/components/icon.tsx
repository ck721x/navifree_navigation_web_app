import type { CSSProperties } from 'react';

const paths = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  sparkles: <><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" /><path d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7L20 2Z" /></>,
  locate: <><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4" /></>,
  cube: <><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v8M7.5 5.5l9 5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20.5 13.5A8.5 8.5 0 0 1 10.5 3a9 9 0 1 0 10 10.5Z" />,
  volume: <><path d="m11 5-6 4H2v6h3l6 4V5Zm4 3a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14" /></>,
  mute: <><path d="m11 5-6 4H2v6h3l6 4V5Zm5 4 6 6m0-6-6 6" /></>,
  north: <path d="m12 3 7 18-7-5-7 5 7-18Z" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  route: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 7v7a4 4 0 0 0 4 4h6M8 5h6a4 4 0 0 1 0 8h-4" /></>,
  pin: <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  send: <><path d="m22 2-7 20-4-9L2 9l20-7ZM11 13 22 2" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />,
  settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>,
} as const;

export function Icon({ name, className = '', style }: { name: keyof typeof paths; className?: string; style?: CSSProperties }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>;
}
