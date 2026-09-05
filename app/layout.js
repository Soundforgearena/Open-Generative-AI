import './globals.css';

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

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}