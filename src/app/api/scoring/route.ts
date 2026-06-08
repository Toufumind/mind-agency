import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MIND_DIR } from '@/lib/data-dir';

const SCORING_DIR = path.join(MIND_DIR, 'scoring');

function ensureDir() {
  if (!fs.existsSync(SCORING_DIR)) fs.mkdirSync(SCORING_DIR, { recursive: true });
}

// POST /api/scoring/evaluate - 评分
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, type, reviewer } = body;
    
    if (!content || !type) {
      return NextResponse.json({ error: 'content and type required' }, { status: 400 });
    }

    // 基于内容特征的真实评分 (6个维度, 每项10分, 总分60)
    const len = content.length;
    const hasTitle = /^#/.test(content);
    const hasEmoji = /[\u{1F600}-\u{1F64F}]/u.test(content);
    const hasList = /^[-*]\s/m.test(content) || /^\d+\.\s/m.test(content);
    const hasDialogue = /["「」]/.test(content);
    const paragraphCount = content.split(/\n\n/).length;

    const scores = {
      quality: Math.min(10, Math.max(5, Math.floor(len / 200) + (hasTitle ? 2 : 0) + (paragraphCount > 3 ? 1 : 0))),
      expression: Math.min(10, Math.max(5, Math.floor(len / 150) + (hasDialogue ? 2 : 0) + (hasEmoji ? 1 : 0))),
      structure: Math.min(10, Math.max(5, (hasTitle ? 3 : 0) + (hasList ? 2 : 0) + (paragraphCount > 2 ? 2 : 0) + 3)),
      audience: Math.min(10, Math.max(5, Math.floor(len / 200) + (hasEmoji ? 2 : 0) + (hasList ? 1 : 0))),
      originality: Math.min(10, Math.max(5, Math.floor(len / 300) + (hasDialogue ? 2 : 0) + 3)),
      virality: Math.min(10, Math.max(5, (hasEmoji ? 2 : 0) + (hasList ? 1 : 0) + Math.floor(len / 250) + 2)),
    };
    
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const percentage = Math.round(total / 60 * 100);
    
    ensureDir();
    const record = {
      id: Date.now().toString(),
      type,
      reviewer: reviewer || 'system',
      scores,
      total,
      percentage,
      timestamp: new Date().toISOString(),
    };
    
    const logFile = path.join(SCORING_DIR, `scoring-${type}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf-8');
    
    return NextResponse.json({ 
      success: true, 
      scores, 
      total, 
      percentage,
      feedback: percentage >= 90 ? '优秀，可发布' : percentage >= 70 ? '良好，需小修改' : '需改进'
    });
  } catch {
    return NextResponse.json({ error: 'Scoring failed' }, { status: 500 });
  }
}

// GET /api/scoring/history - 查看评分历史
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all';
  
  ensureDir();
  const logFile = path.join(SCORING_DIR, `scoring-${type}.jsonl`);
  
  if (!fs.existsSync(logFile)) {
    return NextResponse.json({ history: [] });
  }
  
  const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  const history = lines.map(l => JSON.parse(l)).slice(-20);
  
  return NextResponse.json({ history });
}
