import { NextRequest, NextResponse } from 'next/server';
import { getAgency } from '@/lib/agency';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  const agency = getAgency();
  const proxy = agency.getGroup(name);

  if (!proxy.exists()) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const files = await proxy.getFiles();
  return NextResponse.json({ files });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  const agency = getAgency();
  const proxy = agency.getGroup(name);

  if (!proxy.exists()) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await proxy.uploadFile(filename, buffer);
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

  const agency = getAgency();
  const proxy = agency.getGroup(name);

  if (!proxy.exists()) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const files = await proxy.getFiles();
  if (!files.includes(filename)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  // Delete file by uploading empty buffer (workaround since GroupProxy doesn't have deleteFile)
  // TODO: Add deleteFile method to GroupProxy
  const fs = require('fs');
  const path = require('path');
  const { GROUPS_DIR } = require('@/lib/data-dir');
  const fp = path.join(GROUPS_DIR, name, 'files', filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);

  return NextResponse.json({ success: true });
}
