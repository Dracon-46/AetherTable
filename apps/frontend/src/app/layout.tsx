import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AetherTable - O Seu Novo Card Game',
  description: 'Jogue seus formatos favoritos de card games de forma online, imersiva e gratuita.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased h-screen w-screen overflow-hidden bg-table-deep text-text flex items-center justify-center">
        {children}
      </body>
    </html>
  );
}
