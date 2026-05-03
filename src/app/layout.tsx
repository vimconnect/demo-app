import type { Metadata } from 'next';
import './shared-design-tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vim Connect Demo App',
  description: 'OAuth-enabled demo app for Vim Connect SDK',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Poppins:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="light-mode">
        {children}
      </body>
    </html>
  );
}
