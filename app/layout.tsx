import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Commerk CRM & Bot',
  description: 'Sistema de automatización de ventas por WhatsApp con CRM integrado',
  icons: {
    icon: '/logos_favicon.png',
    shortcut: '/logos_favicon.png',
    apple: '/logos_favicon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
