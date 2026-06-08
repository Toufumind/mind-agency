#!/usr/bin/env python3
"""Fix dedup memory issues in event-bus.ts"""
import sys

fp = 'D:/Projects/Git/Mind/534/src/lib/event-bus.ts'

with open(fp, 'r', encoding='utf-8') as f:
    c = f.read()

changes = 0

# Fix 1: Remove while loop and compact block in emit()
old1_lines = [
    '    while (this.dedupHist.length > MAX_DEDUP) { this.dedup.delete(this.dedupHist.shift()!); }',
    '    // Periodically compact the array to release memory',
    '    if (this.dedupHist.length > MAX_DEDUP * 0.8 && this.dedupHist.length % 1000 === 0) {',
    '      this.dedupHist = this.dedupHist.slice(-MAX_DEDUP / 2);',
    '    }',
]
new1_lines = [
    '    // v0.3.1: Evict oldest entries when over limit (Map preserves insertion order)',
    '    if (this.dedup.size > MAX_DEDUP) {',
    '      const toEvict = this.dedup.size - Math.floor(MAX_DEDUP / 2);',
    '      let evicted = 0;',
    '      for (const key of this.dedup.keys()) {',
    '        if (evicted >= toEvict) break;',
    '        this.dedup.delete(key);',
    '        evicted++;',
    '      }',
    '    }',
]
for sep in ['\n', '\r\n']:
    old1 = sep.join(old1_lines)
    if old1 in c:
        c = c.replace(old1, sep.join(new1_lines))
        changes += 1
        print('Fix 1 OK: emit() dedup logic replaced')
        break
else:
    print('Fix 1 SKIP: emit dedup already replaced')

# Fix 2: replayOutbox
old2 = 'this.dedup.add(ev.id); this.dedupHist.push(ev.id);'
new2 = 'this.dedup.set(ev.id, null);'
if old2 in c:
    c = c.replace(old2, new2)
    changes += 1
    print('Fix 2 OK: replayOutbox dedup fixed')
else:
    print('Fix 2 SKIP: already fixed or different syntax')

# Fix 3: destroy
old3 = 'this.dedup.clear(); this.dedupHist = [];'
new3 = 'this.dedup.clear();'
if old3 in c:
    c = c.replace(old3, new3)
    changes += 1
    print('Fix 3 OK: destroy cleanup fixed')
else:
    print('Fix 3 SKIP: already fixed')

# Fix 4: getStats - dedupSize still references this.dedup which is now a Map
# this.dedup.size works for both Set and Map, so no change needed

# Verify
remaining = []
for i, l in enumerate(c.split('\n'), 1):
    if 'dedupHist' in l and 'v0.3.1' not in l:
        remaining.append(f'  WARNING L{i}: {l.strip()[:100]}')

if remaining:
    print(f'\nRemaining dedupHist references ({len(remaining)}):')
    for r in remaining:
        print(r)
else:
    print('\nAll dedupHist references removed!')

with open(fp, 'w', encoding='utf-8') as f:
    f.write(c)

print(f'\nTotal changes: {changes}')
print(f'File saved: {fp}')
