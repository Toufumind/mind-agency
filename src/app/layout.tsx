import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mind Agency — Agent Company',
  description: 'Multi-agent collaboration platform with email communication',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
