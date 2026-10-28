import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NaviFree — a clearer way to go',
  description: 'A free-first route planning prototype. Explore locally, with optional external services.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
