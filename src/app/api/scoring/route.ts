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

    // 模拟评分 (6个维度, 每项10分, 总分60)
    const scores = {
      quality: Math.floor(Math.random() * 4) + 6,
      expression: Math.floor(Math.random() * 4) + 6,
      structure: Math.floor(Math.random() * 4) + 6,
      audience: Math.floor(Math.random() * 4) + 6,
      originality: Math.floor(Math.random() * 4) + 5,
      virality: Math.floor(Math.random() * 4) + 5,
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
