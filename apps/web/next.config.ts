import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@navifree/core', '@navifree/api-client'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }];
  },
};
export default config;
