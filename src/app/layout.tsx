import type { Metadata } from 'next';
import { Inter, Geist } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/lib/query-client';
import { theme } from '@/lib/theme';
import './globals.css';
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'GeoTalos',
  description: 'Intelligent geospatial forest management platform',
  icons: {
    icon: [{ url: '/GeoTalos_logo.png', type: 'image/png' }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      afterSignOutUrl="/sign-in"
      appearance={{
        variables: {
          colorPrimary: theme.primary,
          colorBackground: theme.almondCream,
          colorText: theme.ebony,
          borderRadius: '0.5rem',
        },
        elements: {
          card: 'shadow-lg border border-primary-100',
          formButtonPrimary:
            'bg-primary text-primary-foreground hover:bg-primary-600 transition-colors',
          footerActionLink: 'text-primary hover:text-primary-600',
        },
      }}
    >
      <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
        <body>
          <QueryProvider>
            {children}
            <Toaster richColors position="top-right" />
          </QueryProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}