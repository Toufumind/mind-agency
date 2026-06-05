import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '@/lib/data-dir';

const FILES_DIR = (group: string) => path.join(GROUPS_DIR, group, 'files');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const dir = FILES_DIR(name);
  if (!fs.existsSync(dir)) return NextResponse.json({ files: [] });

  const files = fs.readdirSync(dir).map(f => {
    const fp = path.join(dir, f);
    try {
      const st = fs.statSync(fp);
      return { name: f, size: st.size, mtime: st.mtimeMs };
    } catch { return null; }
  }).filter(Boolean);

  return NextResponse.json({ files });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const dir = FILES_DIR(name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    fs.writeFileSync(path.join(dir, filename), buffer);
    return NextResponse.json({ success: true, filename, size: buffer.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const { filename } = await request.json();
  if (!filename) return NextResponse.json({ error: 'filename required' }, { status: 400 });

  const fp = path.join(FILES_DIR(name), filename);
  if (!fs.existsSync(fp)) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  fs.unlinkSync(fp);
  return NextResponse.json({ success: true });
}
