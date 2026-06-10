'use client';

import { useTheme } from '@/lib/theme';

// 静态 Logo — 使用 SVG
const LOGO_SVG = '/logo.svg';

// 主题特定的 CSS filter
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
      src={LOGO_SVG}
      alt="Mind Agency"
      width={size}
      height={size}
      style={{
        display: 'block',
        borderRadius: '4px',
        filter,
      }}
    />
  );
}
