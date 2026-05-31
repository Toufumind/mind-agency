#!/usr/bin/env node
// Test script for Mind Agency — handles SSE, proper UTF-8
import http from 'http';

const BASE = 'http://localhost:3000';

async function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const url = new URL(path, BASE);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: {} };
    if (body) opts.headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };

    const req = http.request(opts, res => {
      let out = ''; res.on('data', c => out += c); res.on('end', () => {
        // Handle SSE by extracting the last text event
        if (out.startsWith('data: ')) {
          const last = out.split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]\n')
            .map(l => { try { return JSON.parse(l.slice(6)).content || ''; } catch { return ''; } }).filter(Boolean).join('');
          resolve({ message: last });
        } else { try { resolve(JSON.parse(out)); } catch { resolve({ text: out.slice(0, 500) }); } }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // 1. Create PM: Diana
  console.log('Step 1: Create PM agent Diana');
  let r = await request('POST', '/api/agents', { name: 'Diana', roles: ['PM', 'CEO'], autoRespondToEmail: true, permissions: { canCreateGroup: true, canDeleteGroup: true, canDeploy: true } });
  console.log('  Diana:', JSON.stringify(r).slice(0, 200));

  // 2. Upgrade Alice to CEO
  r = await request('PUT', '/api/agents/Alice/config', { roles: ['admin', 'CEO'], permissions: { canCreateGroup: true, canDeleteGroup: true, canDeploy: true } });
  console.log('  Alice:', JSON.stringify(r).slice(0, 200));

  // 3. Alice posts team plan
  console.log('\nStep 2: Alice posts team building plan');
  r = await request('POST', '/api/agents/Alice/chat', {
    message: '用 group_send 在 default 群发公告：团队通知 — 我们新增了 Diana 作为产品经理(PM/CEO)。她将负责 v0.5.0 的产品规划。我们需要讨论：1)要不要创建 UI 工程师和 QA 工程师两个新 Agent 2)各自职责边界 3)v0.5.0 的时间线。请 @Bob @Charlie 直接在群里发表意见。只沟通。',
    group: 'default'
  });
  console.log('  Alice:', (r.message || r.text || '').slice(0, 300));

  // 4. Poll
  console.log('\nStep 3: Poll (x2)');
  for (let i = 1; i <= 2; i++) {
    await sleep(6000);
    r = await request('POST', '/api/poll');
    const triggered = JSON.stringify(r).match(/"triggered":true/g)?.length || 0;
    console.log(`  Poll #${i}: ${triggered} agents triggered`);
  }

  // 5. Read chat
  await sleep(4000);
  console.log('\nStep 4: Group chat');
  const fs = await import('fs');
  const chatDir = 'D:/Projects/Git/Mind/534/Groups/default/chat';
  if (fs.existsSync(chatDir)) {
    const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).sort();
    for (const f of files) {
      const content = fs.readFileSync(`${chatDir}/${f}`, 'utf-8');
      console.log('\n' + content.slice(0, 600));
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(console.error);
