import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/lib/auth/auth-context';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AcqDis — Wholesale Real Estate CRM',
  description: 'The complete CRM for wholesale real estate. Manage acquisitions, dispositions, and your entire pipeline.',
  metadataBase: new URL('https://acqdis.com'),
  openGraph: {
    title: 'AcqDis — Wholesale Real Estate CRM',
    description: 'The complete CRM for wholesale real estate. Manage acquisitions, dispositions, and your entire pipeline.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'AcqDis',
      },
    ],
    type: 'website',
    siteName: 'AcqDis',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AcqDis — Wholesale Real Estate CRM',
    description: 'The complete CRM for wholesale real estate. Manage acquisitions, dispositions, and your entire pipeline.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: [
      { url: '/ChatGPT_Image_Jul_31,_2026,_02_12_00_PM.png', type: 'image/png' },
    ],
    apple: '/ChatGPT_Image_Jul_31,_2026,_02_12_00_PM.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
