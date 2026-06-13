/**
 * Fix empty catch blocks: replace `catch {}` and `catch (e) {}` with `catch (e) { console.error('[context]', e); }`
 * Context is derived from the file name.
 */
import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'fs';
import { execSync } from 'child_process';

const files = execSync('grep -rl "catch\\s*{}" src/ --include="*.ts" --include="*.tsx"', { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

let totalFixed = 0;

for (const file of files) {
  let content = readFileSync(file, 'utf8');
  const original = content;

  // Derive context from filename
  const ctx = file.replace('src/', '').replace(/\.(ts|tsx)$/, '').replace(/\//g, ':').replace(/\\/g, ':');

  // Fix `catch {}` → `catch (e) { console.error('[ctx]', e); }`
  content = content.replace(/catch\s*\{\}/g, `catch (e) { console.error('[${ctx}]', e); }`);

  // Fix `catch (e) {}` → `catch (e) { console.error('[ctx]', e); }`
  // Only if the catch body is truly empty (no content between braces)
  content = content.replace(/catch\s*\((\w+)\)\s*\{\s*\}/g, `catch ($1) { console.error('[${ctx}]', $1); }`);

  if (content !== original) {
    const fixes = (content.match(/console\.error/g) || []).length - (original.match(/console\.error/g) || []).length;
    writeFileSync(file, content);
    totalFixed += fixes;
    console.log(`  Fixed ${fixes} in ${file}`);
  }
}

console.log(`\nTotal: ${totalFixed} empty catch blocks fixed across ${files.length} files`);
