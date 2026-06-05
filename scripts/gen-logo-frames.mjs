#!/usr/bin/env node
/**
 * Logo 序列帧生成器 — Node.js 版
 * 纯 JS raymarcher，无需 GPU / headless-gl
 * 输出 PNG 序列帧 + sprite sheet
 *
 * 用法: node scripts/gen-logo-frames.mjs [--frames 24] [--size 256] [--duration 2] [--out public/shaders/frames]
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ---- Parse args ----
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const FRAME_COUNT = parseInt(getArg('frames', '24'));
const SIZE = parseInt(getArg('size', '256'));
const DURATION = parseFloat(getArg('duration', '2'));
const OUT_DIR = getArg('out', 'public/shaders/frames');

mkdirSync(OUT_DIR, { recursive: true });

// ---- GLSL→JS math ----
const fract = x => x - Math.floor(x);
const mix3 = (a, b, t) => a + (b - a) * t;
const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;

function hash3(p) {
  let x = fract(p[0] * 0.3183099 + 0.1);
  let y = fract(p[1] * 0.3183099 + 0.1);
  let z = fract(p[2] * 0.3183099 + 0.1);
  x *= 17; y *= 17; z *= 17;
  return fract(x * y * z * (x + y + z));
}

function noise3(x) {
  const ix = Math.floor(x[0]), iy = Math.floor(x[1]), iz = Math.floor(x[2]);
  let fx = x[0] - ix, fy = x[1] - iy, fz = x[2] - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const h = (dx, dy, dz) => hash3([ix + dx, iy + dy, iz + dz]);
  return mix3(
    mix3(mix3(h(0,0,0), h(1,0,0), fx), mix3(h(0,1,0), h(1,1,0), fx), fy),
    mix3(mix3(h(0,0,1), h(1,0,1), fx), mix3(h(0,1,1), h(1,1,1), fx), fy),
    fz
  );
}

function fbm(px, py, pz) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 5; i++) {
    v += a * noise3([px, py, pz]);
    px = px * 2 + 100; py = py * 2 + 100; pz = pz * 2 + 100;
    a *= 0.5;
  }
  return v;
}

function palette(d) {
  return [mix3(0.2, 1.0, d), mix3(0.7, 0.0, d), mix3(0.9, 1.0, d)];
}

function v3len(v) { return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); }

// ---- Raymarcher (inlined for perf) ----
function renderPixel(uvx, uvy, time) {
  // camera
  const c = Math.cos(time * 0.3), s = Math.sin(time * 0.3);
  const ro = [c * -14, 0, s * -14];

  // basis
  const cf = [-ro[0], -ro[1], -ro[2]];
  const cfLen = v3len(cf);
  const cfx = cf[0]/cfLen, cfy = cf[1]/cfLen, cfz = cf[2]/cfLen;

  // cs = normalize(cross(cf, [0,1,0]))
  let csx = -cfz, csy = 0, csz = cfx;
  const csLen = v3len([csx, csy, csz]);
  csx /= csLen; csy /= csLen; csz /= csLen;

  // cu = normalize(cross(cf, cs))
  let cux = cfy*csz - cfz*csy;
  let cuy = cfz*csx - cfx*csz;
  let cuz = cfx*csy - cfy*csx;
  const cuLen = v3len([cux, cuy, cuz]);
  cux /= cuLen; cuy /= cuLen; cuz /= cuLen;

  // rd = normalize(ro + cf*3 + uvx*cs + uvy*cu - ro) = normalize(cf*3 + uvx*cs + uvy*cu)
  let rdx = cfx*3 + uvx*csx + uvy*cux;
  let rdy = cfy*3 + uvx*csy + uvy*cuy;
  let rdz = cfz*3 + uvx*csz + uvy*cuz;
  const rdLen = v3len([rdx, rdy, rdz]);
  rdx /= rdLen; rdy /= rdLen; rdz /= rdLen;

  // raymarch
  let tt = 0, col0 = 0, col1 = 0, col2 = 0, d = 0;
  for (let step = 0; step < 80; step++) {
    const px = ro[0] + rdx * tt;
    const py = ro[1] + rdy * tt;
    const pz = ro[2] + rdz * tt;

    const sphere = v3len([px, py, pz]);
    const n = fbm(px * 0.2 + time * 0.2, py * 0.2 + time * 0.2, pz * 0.2 + time * 0.2);
    d = sphere - n * 2.9;

    if (d < 0.02 || tt > 100) break;
    const pl = palette(v3len([px, py, pz]) * 0.1);
    const denom = 300 * d;
    col0 += pl[0] / denom;
    col1 += pl[1] / denom;
    col2 += pl[2] / denom;
    tt += d;
  }
  const alpha = clamp(1 / (d * 100), 0, 1);
  return [
    clamp(Math.round(col0 * 255), 0, 255),
    clamp(Math.round(col1 * 255), 0, 255),
    clamp(Math.round(col2 * 255), 0, 255),
    clamp(Math.round(alpha * 255), 0, 255)
  ];
}

// ---- PNG encoder ----
function crc32(buf) {
  let c = 0xffffffff;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    t[n] = v;
  }
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function u32be(v) {
  return [(v>>>24)&255, (v>>>16)&255, (v>>>8)&255, v&255];
}

function makeChunk(type, data) {
  const len = data.length;
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = crc32(crcInput);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(len, 0);
  header.write(type, 4, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf[0] = (crc>>>24)&255; crcBuf[1] = (crc>>>16)&255;
  crcBuf[2] = (crc>>>8)&255;  crcBuf[3] = crc&255;
  return Buffer.concat([header, data, crcBuf]);
}

function createPNG(width, height, rgba) {
  // Uncompressed deflate (stored blocks)
  const rawLen = height * (1 + width * 4);
  const raw = Buffer.alloc(rawLen);
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  // Deflate stored blocks
  const MAX_BLOCK = 65535;
  const blocks = [];
  let pos = 0;
  while (pos < raw.length) {
    const blockLen = Math.min(raw.length - pos, MAX_BLOCK);
    const isLast = pos + blockLen >= raw.length;
    blocks.push(isLast ? 0x01 : 0x00);
    blocks.push(blockLen & 0xff, (blockLen >> 8) & 0xff);
    blocks.push((~blockLen) & 0xff, ((~blockLen) >> 8) & 0xff);
    for (let i = 0; i < blockLen; i++) blocks.push(raw[pos + i]);
    pos += blockLen;
  }

  // Adler32
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = (b << 16) | a;

  const idat = Buffer.alloc(2 + blocks.length + 4);
  idat[0] = 0x78; idat[1] = 0x01;
  Buffer.from(blocks).copy(idat, 2);
  const ao = 2 + blocks.length;
  idat[ao]=(adler>>>24)&255; idat[ao+1]=(adler>>>16)&255;
  idat[ao+2]=(adler>>>8)&255; idat[ao+3]=adler&255;

  const ihdr = Buffer.alloc(13);
  ihdr[0]=(width>>>24)&255; ihdr[1]=(width>>>16)&255; ihdr[2]=(width>>>8)&255; ihdr[3]=width&255;
  ihdr[4]=(height>>>24)&255; ihdr[5]=(height>>>16)&255; ihdr[6]=(height>>>8)&255; ihdr[7]=height&255;
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- Render all frames (keep pixels in memory) ----
console.log(`🚀 生成 Logo 序列帧: ${FRAME_COUNT}帧, ${SIZE}×${SIZE}, 周期${DURATION}s`);

const startTime = Date.now();
const allPixels = []; // Array of Uint8Array

for (let frame = 0; frame < FRAME_COUNT; frame++) {
  const time = (frame / FRAME_COUNT) * DURATION;
  const pixels = Buffer.alloc(SIZE * SIZE * 4);

  for (let py = 0; py < SIZE; py++) {
    const uvy = (SIZE / 2 - py) / SIZE;
    for (let px = 0; px < SIZE; px++) {
      const uvx = (px - SIZE / 2) / SIZE;
      const [r, g, b, alpha] = renderPixel(uvx, uvy, time);
      const idx = (py * SIZE + px) * 4;
      pixels[idx] = r; pixels[idx+1] = g; pixels[idx+2] = b; pixels[idx+3] = alpha;
    }
  }

  allPixels.push(pixels);

  // Save individual frame
  const pad = String(FRAME_COUNT).length;
  const filename = `logo_${String(frame).padStart(pad, '0')}.png`;
  writeFileSync(join(OUT_DIR, filename), createPNG(SIZE, SIZE, pixels));

  const pct = ((frame + 1) / FRAME_COUNT * 100).toFixed(0);
  process.stdout.write(`\r  渲染中... ${frame + 1}/${FRAME_COUNT} (${pct}%)`);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n✅ 序列帧完成 — ${FRAME_COUNT}帧 (${elapsed}s)`);

// ---- Sprite Sheet (from memory, no re-read) ----
const cols = Math.ceil(Math.sqrt(FRAME_COUNT));
const rows = Math.ceil(FRAME_COUNT / cols);
const sheetW = SIZE * cols;
const sheetH = SIZE * rows;
const sheet = Buffer.alloc(sheetW * sheetH * 4);

for (let i = 0; i < FRAME_COUNT; i++) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const src = allPixels[i];
  for (let y = 0; y < SIZE; y++) {
    const srcOff = y * SIZE * 4;
    const dstOff = (row * SIZE + y) * sheetW * 4 + col * SIZE * 4;
    src.copy(sheet, dstOff, srcOff, srcOff + SIZE * 4);
  }
}

const spriteFile = `logo_sprite_${FRAME_COUNT}f_${SIZE}x${SIZE}.png`;
writeFileSync(join(OUT_DIR, spriteFile), createPNG(sheetW, sheetH, sheet));

console.log(`🧩 Sprite Sheet: ${cols}×${rows} 网格 → ${OUT_DIR}/${spriteFile}`);
console.log(`\n📊 总结:`);
console.log(`   帧数: ${FRAME_COUNT}`);
console.log(`   分辨率: ${SIZE}×${SIZE}`);
console.log(`   周期: ${DURATION}s`);
console.log(`   网格: ${cols}×${rows}`);
console.log(`   输出: ${OUT_DIR}/`);
