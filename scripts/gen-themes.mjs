/**
 * Generate theme CSS from JS definitions.
 * Run: node scripts/gen-themes.mjs
 * Output: src/app/themes-generated.css
 */
import { writeFileSync } from 'fs';
import { generateThemeCSS } from './themes.mjs';

const css = `/* ═══════════════════════════════════════════════════════════
   AUTO-GENERATED — Do not edit manually.
   Edit scripts/themes.mjs instead, then run:
   node scripts/gen-themes.mjs
   ═══════════════════════════════════════════════════════════ */

${generateThemeCSS()}`;

writeFileSync('src/app/themes-generated.css', css);
console.log(`[gen-themes] Generated ${Object.keys(JSON.parse('{}')).length || 8} themes → src/app/themes-generated.css`);
