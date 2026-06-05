/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ═══ 品牌色板（Primitive，不变） ═══
        agency: {
          50:  '#f0f4ff',
          100: '#dbe4ff',
          200: '#bac8ff',
          300: '#91a7ff',
          400: '#748ffc',
          500: '#5c7cfa',
          600: '#4c6ef5',
          700: '#4263eb',
          800: '#3b5bdb',
          900: '#364fc7',
          950: '#2b3fa0',
        },
        // ═══ 语义 Token（引用 CSS 变量，支持多主题） ═══
        // 背景层级
        canvas:            'var(--color-canvas)',
        surface:           'var(--color-surface)',
        'surface-alt':     'var(--color-surface-alt)',
        'surface-hover':   'var(--color-surface-hover)',
        // 文本层级
        foreground:        'var(--color-foreground)',
        muted:             'var(--color-muted)',
        'muted-foreground':'var(--color-muted-foreground)',
        disabled:          'var(--color-disabled)',
        // 边框层级
        border:            'var(--color-border)',
        'border-strong':   'var(--color-border-strong)',
        // 主色
        primary:           'var(--color-primary)',
        'primary-hover':   'var(--color-primary-hover)',
        'primary-muted':   'var(--color-primary-muted)',
        'primary-subtle':  'var(--color-primary-subtle)',
        // 状态色
        success:           'var(--color-success)',
        'success-muted':   'var(--color-success-muted)',
        warning:           'var(--color-warning)',
        'warning-muted':   'var(--color-warning-muted)',
        destructive:       'var(--color-destructive)',
        'destructive-muted':'var(--color-destructive-muted)',
        info:              'var(--color-info)',
        'info-muted':      'var(--color-info-muted)',
      },
      borderRadius: {
        'xs':  '0.125rem', // 2px
        'sm':  '0.25rem',  // 4px
        'md':  '0.375rem', // 6px
        'lg':  '0.5rem',   // 8px
        'xl':  '0.75rem',  // 12px
        '2xl': '1rem',     // 16px
        '3xl': '1.25rem',  // 20px
      },
      boxShadow: {
        'xs': '0 1px 2px rgba(0,0,0,0.04)',
        'sm': '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'md': '0 4px 6px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.04)',
        'lg': '0 10px 15px rgba(0,0,0,0.06), 0 4px 6px rgba(0,0,0,0.04)',
        'xl': '0 20px 25px rgba(0,0,0,0.08), 0 8px 10px rgba(0,0,0,0.04)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
