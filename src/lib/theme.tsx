/**
 * Theme system — provides light/dark/warm theme switching.
 * CSS variables are defined in globals.css via tailwind classes.
 */

'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type ThemeId = 'minimal-white' | 'notion' | 'warm-wood' | 'deep-space' | 'nord';

export const THEMES: { id: ThemeId; label: string; labelZh: string }[] = [
  { id: 'notion', label: 'Notion', labelZh: 'Notion' },
  { id: 'minimal-white', label: 'Minimal White', labelZh: '极简白' },
  { id: 'warm-wood', label: 'Warm Wood', labelZh: '暖木' },
  { id: 'deep-space', label: 'Deep Space', labelZh: '深空' },
  { id: 'nord', label: 'Nord', labelZh: '北极' },
];

interface ThemeContextType {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

const ThemeCtx = createContext<ThemeContextType>({ theme: 'notion' as ThemeId, setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>('notion');

  useEffect(() => {
    try {
      const s = localStorage.getItem('mind-theme');
      if (s && THEMES.some(t => t.id === s)) {
        setThemeState(s as ThemeId);
        document.documentElement.setAttribute('data-theme', s);
      }
    } catch {}
  }, []);

  const setTheme = (t: ThemeId) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('mind-theme', t); } catch {}
  };

  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() { return useContext(ThemeCtx); }
