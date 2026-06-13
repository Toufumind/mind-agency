'use client';

import { useTheme } from '@/lib/theme';

/**
 * Logo — static SVG, no canvas animation.
 * taste: "Replace canvas animation with static asset"
 * Eliminates 3 persistent rAF loops (was 12 FPS × 3 instances).
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
  // In standalone build, public/ files are served from /_next/static/public/
  // In dev mode, they're served from root
  const isStandalone = typeof window !== 'undefined' && !window.location.port;
  const prefix = isStandalone ? '/_next/static/public' : '';
  const src = DARK_THEMES.has(theme) ? `${prefix}/shaders/frames_dark/logo_sprite_48f_512x512.png` : `${prefix}/logo.svg`;

  // Use first frame of sprite sheet (index 0,0) or static SVG
  return (
    <img
      src={src}
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
