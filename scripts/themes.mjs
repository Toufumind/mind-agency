/**
 * Theme definitions — single source of truth for all themes.
 * Run: node scripts/gen-themes.mjs → outputs to src/app/themes-generated.css
 */

export const themes = {
  'minimal-white': {
    // Uses :root defaults — no overrides needed
  },

  'deep-space': {
    '--color-canvas':         '#0d0d12',
    '--color-surface':        '#16161d',
    '--color-surface-alt':    '#1c1c24',
    '--color-surface-hover':  '#22222b',
    '--color-foreground':     '#e8e8ed',
    '--color-muted':          '#9898a8',
    '--color-muted-foreground': '#606070',
    '--color-disabled':       '#3d3d4d',
    '--color-border':         '#23232d',
    '--color-border-strong':  '#32323f',
    '--color-primary':        '#3b82f6',
    '--color-primary-hover':  '#2563eb',
    '--color-primary-muted':  '#1e3a5f',
    '--color-primary-subtle': '#172554',
    '--color-success':        '#3fb950',
    '--color-success-muted':  '#0b2e1a',
    '--color-warning':        '#d29922',
    '--color-warning-muted':  '#2d1f00',
    '--color-destructive':    '#f85149',
    '--color-destructive-muted': '#2d0b0b',
    '--color-info':           '#58a6ff',
    '--color-info-muted':     '#0c1929',
  },

  'warm-wood': {
    '--color-canvas':         '#faf6f1',
    '--color-surface':        '#f0ebe4',
    '--color-surface-alt':    '#e8e2d8',
    '--color-surface-hover':  '#ddd6ca',
    '--color-foreground':     '#3d3229',
    '--color-muted':          '#8a7e72',
    '--color-muted-foreground': '#6b6054',
    '--color-disabled':       '#c4b9ad',
    '--color-border':         '#d4c9bb',
    '--color-border-strong':  '#b8a998',
    '--color-primary':        '#c07830',
    '--color-primary-hover':  '#a86828',
    '--color-primary-muted':  '#f5e6d0',
    '--color-primary-subtle': '#fdf3e7',
    '--color-success':        '#5a9a3c',
    '--color-success-muted':  '#e8f5e0',
    '--color-warning':        '#c08830',
    '--color-warning-muted':  '#fef3d8',
    '--color-destructive':    '#c04040',
    '--color-destructive-muted': '#fde8e8',
    '--color-info':           '#4a80b0',
    '--color-info-muted':     '#e0f0ff',
  },

  'notion': {
    '--color-canvas':         '#ffffff',
    '--color-surface':        '#f7f7f5',
    '--color-surface-alt':    '#efefed',
    '--color-surface-hover':  '#e8e8e5',
    '--color-foreground':     '#37352f',
    '--color-muted':          '#9b9a97',
    '--color-muted-foreground': '#787774',
    '--color-disabled':       '#d3d3d0',
    '--color-border':         '#e3e3e0',
    '--color-border-strong':  '#c0bfbc',
    '--color-primary':        '#2383e2',
    '--color-primary-hover':  '#1b6ec2',
    '--color-primary-muted':  '#e8f0fe',
    '--color-primary-subtle': '#f0f6ff',
    '--color-success':        '#0f7b6c',
    '--color-success-muted':  '#e6f5f0',
    '--color-warning':        '#d9730d',
    '--color-warning-muted':  '#fef3d8',
    '--color-destructive':    '#e03e3e',
    '--color-destructive-muted': '#fde8e8',
    '--color-info':           '#4a80b0',
    '--color-info-muted':     '#e0f0ff',
  },

  'nord': {
    '--color-canvas':         '#2e3440',
    '--color-surface':        '#3b4252',
    '--color-surface-alt':    '#434c5e',
    '--color-surface-hover':  '#4c566a',
    '--color-foreground':     '#eceff4',
    '--color-muted':          '#a0a8c0',
    '--color-muted-foreground': '#7b88a0',
    '--color-disabled':       '#5a6378',
    '--color-border':         '#4c566a',
    '--color-border-strong':  '#616e88',
    '--color-primary':        '#88c0d0',
    '--color-primary-hover':  '#81a1c1',
    '--color-primary-muted':  '#3b4c5e',
    '--color-primary-subtle': '#2e3c48',
    '--color-success':        '#a3be8c',
    '--color-success-muted':  '#3a4a3a',
    '--color-warning':        '#ebcb8b',
    '--color-warning-muted':  '#4a4030',
    '--color-destructive':    '#bf616a',
    '--color-destructive-muted': '#4a3030',
    '--color-info':           '#88c0d0',
    '--color-info-muted':     '#2e3c48',
  },

  'tokyo-night': {
    '--color-canvas':         '#1a1b26',
    '--color-surface':        '#24283b',
    '--color-surface-alt':    '#292e42',
    '--color-surface-hover':  '#33384f',
    '--color-foreground':     '#c0caf5',
    '--color-muted':          '#565f89',
    '--color-muted-foreground': '#737aa2',
    '--color-disabled':       '#414868',
    '--color-border':         '#3b4261',
    '--color-border-strong':  '#545c7e',
    '--color-primary':        '#7aa2f7',
    '--color-primary-hover':  '#89b4fa',
    '--color-primary-muted':  '#283457',
    '--color-primary-subtle': '#1e2640',
    '--color-success':        '#9ece6a',
    '--color-success-muted':  '#2a3a2a',
    '--color-warning':        '#e0af68',
    '--color-warning-muted':  '#3a3520',
    '--color-destructive':    '#f7768e',
    '--color-destructive-muted': '#3a2028',
    '--color-info':           '#7dcfff',
    '--color-info-muted':     '#1a2a3a',
  },

  'dracula': {
    '--color-canvas':         '#282a36',
    '--color-surface':        '#343746',
    '--color-surface-alt':    '#3c3f58',
    '--color-surface-hover':  '#44475a',
    '--color-foreground':     '#f8f8f2',
    '--color-muted':          '#6272a4',
    '--color-muted-foreground': '#8088a8',
    '--color-disabled':       '#525578',
    '--color-border':         '#44475a',
    '--color-border-strong':  '#6272a4',
    '--color-primary':        '#bd93f9',
    '--color-primary-hover':  '#a97cf8',
    '--color-primary-muted':  '#383a54',
    '--color-primary-subtle': '#2d2f44',
    '--color-success':        '#50fa7b',
    '--color-success-muted':  '#1a3a2a',
    '--color-warning':        '#f1fa8c',
    '--color-warning-muted':  '#3a3a20',
    '--color-destructive':    '#ff5555',
    '--color-destructive-muted': '#3a1a1a',
    '--color-info':           '#8be9fd',
    '--color-info-muted':     '#1a2a3a',
  },

  'solarized-light': {
    '--color-canvas':         '#fdf6e3',
    '--color-surface':        '#eee8d5',
    '--color-surface-alt':    '#e4ddc8',
    '--color-surface-hover':  '#d6cfbe',
    '--color-foreground':     '#073642',
    '--color-muted':          '#839496',
    '--color-muted-foreground': '#657b83',
    '--color-disabled':       '#b8c4cc',
    '--color-border':         '#d3cdb8',
    '--color-border-strong':  '#b8b098',
    '--color-primary':        '#268bd2',
    '--color-primary-hover':  '#1a6da0',
    '--color-primary-muted':  '#d4e8f8',
    '--color-primary-subtle': '#e8f2fa',
    '--color-success':        '#859900',
    '--color-success-muted':  '#e8f0d8',
    '--color-warning':        '#b58900',
    '--color-warning-muted':  '#f8f0d0',
    '--color-destructive':    '#dc322f',
    '--color-destructive-muted': '#f8e0e0',
    '--color-info':           '#2aa198',
    '--color-info-muted':     '#e0f4f0',
  },
};

// CSS variable ordering (consistent across all themes)
const VAR_ORDER = [
  '--color-canvas', '--color-surface', '--color-surface-alt', '--color-surface-hover',
  '--color-foreground', '--color-muted', '--color-muted-foreground', '--color-disabled',
  '--color-border', '--color-border-strong',
  '--color-primary', '--color-primary-hover', '--color-primary-muted', '--color-primary-subtle',
  '--color-success', '--color-success-muted',
  '--color-warning', '--color-warning-muted',
  '--color-destructive', '--color-destructive-muted',
  '--color-info', '--color-info-muted',
];

export function generateThemeCSS() {
  let css = '';

  for (const [name, vars] of Object.entries(themes)) {
    const entries = VAR_ORDER.filter(k => vars[k]).map(k => `  ${k}: ${vars[k]};`);
    if (entries.length === 0) {
      css += `\n[data-theme="${name}"] {\n  /* Uses :root defaults */\n}\n`;
    } else {
      css += `\n[data-theme="${name}"] {\n${entries.join('\n')}\n}\n`;
    }
  }

  // Notion-specific overrides
  css += `\n[data-theme="notion"] .bg-canvas { border-color: transparent; }\n`;
  css += `[data-theme="notion"] .bg-surface { border-color: transparent; }\n`;
  css += `[data-theme="notion"] input, [data-theme="notion"] textarea, [data-theme="notion"] select { border-color: transparent; }\n`;

  return css;
}
