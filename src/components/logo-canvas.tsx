'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/theme';

// 序列帧 Sprite Sheet 动画
// 白底版本，深色主题自动 invert 滤镜

const SPRITE_SHEET = '/shaders/frames_white/logo_sprite_48f_512x512.png';
const TOTAL_FRAMES = 48;
const GRID_COLS = 7;
const FPS = 12;

// 深色主题需要 invert
const DARK_THEMES = new Set(['warm-wood', 'deep-space', 'nord']);

export default function LogoCanvas({ size = 28 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);

  // 加载 sprite sheet
  useEffect(() => {
    const img = new Image();
    img.src = SPRITE_SHEET;
    img.onload = () => setSheet(img);
  }, []);

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

  const isDark = DARK_THEMES.has(theme);

  // 主题色映射 — 让 logo 染上主题的主色
  const themeFilters: Record<string, string> = {
    'notion': 'sepia(0.3) saturate(1.5) hue-rotate(200deg)',     // 偏蓝
    'minimal-white': 'none',                                       // 原色
    'warm-wood': 'sepia(0.4) saturate(1.2) hue-rotate(10deg)',    // 偏暖棕
    'deep-space': 'invert(1) saturate(1.3)',                       // 反色+饱和
    'nord': 'invert(1) saturate(0.8) hue-rotate(180deg)',         // 反色+冷调
  };
  const filter = themeFilters[theme] || 'none';

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
