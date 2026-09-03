import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'CinexVideo - Create Cinematic Videos with AI',
  description: 'Professional-grade AI video generation platform',
  icons: {
    icon: '/cinexvideo-favicon.svg',
    apple: '/cinexvideo-favicon.svg',
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
