import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import './globals.css';
import DemoModeBanner from '@/components/DemoModeBanner';
import { shouldGateRequest } from '@/lib/site-gate';

export const metadata = {
  title: 'CineXVideo — Your Story. Now in Motion.',
  description:
    'Create cinematic AI video experiences from your story, script, or a production-ready template.',
  icons: {
    icon: '/favicon.jpg',
    shortcut: '/favicon.jpg',
    apple: '/favicon.jpg',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }) {
  // Pre-launch gate: the public sees the under-construction page, admins see
  // the real site. Toggled from the admin control deck.
  const requestHeaders = await headers();
  if (await shouldGateRequest(requestHeaders.get('x-pathname'))) redirect('/under-construction');

  return (
    <html lang="en">
      <body><DemoModeBanner />{children}</body>
    </html>
  );
}