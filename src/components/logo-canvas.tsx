'use client';

import { useTheme } from '@/lib/theme';

/**
 * Logo — inline SVG, no external file dependency.
 * Works in dev, standalone, and packaged Electron without server routing.
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
  const isDark = DARK_THEMES.has(theme);

  // Inline SVG — no /logo.svg dependency, works everywhere
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        display: 'block',
        borderRadius: '4px',
        filter,
      }}
    >
      <defs>
        <radialGradient id="sphere" cx="45%" cy="40%" r="55%">
          <stop offset="0%" stopColor={isDark ? '#66DDFF' : '#33CCFF'} stopOpacity="0.95" />
          <stop offset="35%" stopColor={isDark ? '#55BBFF' : '#44AAFF'} stopOpacity="0.9" />
          <stop offset="55%" stopColor={isDark ? '#AA77FF' : '#9966FF'} stopOpacity="0.85" />
          <stop offset="75%" stopColor={isDark ? '#DD55FF' : '#CC44FF'} stopOpacity="0.7" />
          <stop offset="100%" stopColor={isDark ? '#FF22FF' : '#FF00FF'} stopOpacity="0.3" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx="16" cy="16" r="10" fill={isDark ? '#66DDFF' : '#33CCFF'} opacity="0.15" filter="url(#glow)" />
      <ellipse cx="16" cy="16" rx="9.5" ry="9.5" fill="url(#sphere)" />
      <ellipse cx="14" cy="13" rx="4" ry="3.5" fill="white" opacity="0.15" />
      <circle cx="9" cy="12" r="0.8" fill={isDark ? '#66DDFF' : '#33CCFF'} opacity="0.6" />
      <circle cx="22" cy="10" r="0.6" fill={isDark ? '#77BBFF' : '#66AAFF'} opacity="0.5" />
      <circle cx="24" cy="18" r="0.7" fill={isDark ? '#BB77FF' : '#AA66FF'} opacity="0.4" />
      <circle cx="11" cy="24" r="0.5" fill={isDark ? '#FF55FF' : '#FF44FF'} opacity="0.3" />
      <circle cx="19" cy="23" r="0.6" fill={isDark ? '#DD66FF' : '#CC55FF'} opacity="0.35" />
      <circle cx="7" cy="19" r="0.5" fill={isDark ? '#66CCFF' : '#55BBFF'} opacity="0.4" />
    </svg>
  );
}
