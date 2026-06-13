'use client';

import { useTheme } from '@/lib/theme';

/**
 * Logo — loads from public/logo.svg.
 * In standalone/EXE mode, public/ is copied to .next-server/public/
 * and served at /logo.svg by Next.js standalone server.
 */

const DARK_THEMES = new Set(['deep-space', 'nord', 'tokyo-night', 'dracula']);

const THEME_FILTERS: Record<string, string> = {
  'minimal-white': 'none',
  'notion': 'saturate(1.2)',
  'warm-wood': 'sepia(0.25) saturate(1.3) brightness(1.05)',
  'solarized-light': 'sepia(0.1) saturate(1.1)',
  'deep-space': 'brightness(1.2) saturate(1.4)',
  'nord': 'brightness(1.3) saturate(0.9) hue-rotate(10deg)',
  'tokyo-night': 'brightness(1.3) saturate(1.2) hue-rotate(200deg)',
  'dracula': 'brightness(1.2) saturate(1.3) hue-rotate(240deg)',
};

export default function LogoCanvas({ size = 28 }: { size?: number }) {
  const { theme } = useTheme();
  const filter = THEME_FILTERS[theme] || 'none';

  return (
    <img
      src="/logo.svg"
      alt="Mind Agency"
      width={size}
      height={size}
      style={{
        display: 'block',
        borderRadius: '4px',
        filter,
        objectFit: 'cover',
      }}
    />
  );
}
