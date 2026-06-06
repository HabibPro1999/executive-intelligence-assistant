import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Executive Intelligence Assistant',
  description:
    'A secure, document-grounded executive intelligence assistant that transforms approved uploaded documents into decision-ready strategic outputs with source traceability.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
