'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/theme';

// 序列帧 Sprite Sheet 动画
// 浅色主题用白底版，深色主题用透明底版

const SPRITE_LIGHT = '/shaders/frames_white/logo_sprite_48f_512x512.png';
const SPRITE_DARK = '/shaders/frames_dark/logo_sprite_48f_512x512.png';
const TOTAL_FRAMES = 48;
const GRID_COLS = 7;
const FPS = 12;

const DARK_THEMES = new Set(['deep-space', 'nord', 'tokyo-night', 'dracula']);

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);

  // 根据主题加载对应的 sprite sheet
  useEffect(() => {
    const src = DARK_THEMES.has(theme) ? SPRITE_DARK : SPRITE_LIGHT;
    const img = new Image();
    img.src = src;
    img.onload = () => setSheet(img);
  }, [theme]);

  // 动画循环
  useEffect(() => {
    if (!sheet || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const frameW = sheet.width / GRID_COLS;
    const frameH = sheet.height / Math.ceil(TOTAL_FRAMES / GRID_COLS);
    let frame = 0;
    let lastTime = 0;
    let raf = 0;

    function draw(time: number) {
      if (!ctx || !sheet) return;
      if (time - lastTime >= 1000 / FPS) {
        lastTime = time;
        const col = frame % GRID_COLS;
        const row = Math.floor(frame / GRID_COLS);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
          sheet as CanvasImageSource,
          col * frameW, row * frameH, frameW, frameH,
          0, 0, canvas.width, canvas.height
        );

        frame = (frame + 1) % TOTAL_FRAMES;
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(raf);
  }, [sheet]);

  const filter = THEME_FILTERS[theme] || 'none';

  return (
    <canvas
      ref={canvasRef}
      width={size * 2}
      height={size * 2}
      style={{
        width: size,
        height: size,
        display: 'block',
        borderRadius: '4px',
        filter,
      }}
    />
  );
}
