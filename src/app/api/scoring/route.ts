import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MIND_DIR } from '@/lib/data-dir';

const SCORING_DIR = path.join(MIND_DIR, 'scoring');
const LEARNING_DIR = path.join(MIND_DIR, 'learning');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Heuristic evaluation — fast, free, no AI call */
function heuristicEvaluate(content: string, type: string) {
  const len = content.length;
  const hasTitle = /^#/.test(content);
  const hasList = /^[-*]\s/m.test(content) || /^\d+\.\s/m.test(content);
  const paragraphCount = content.split(/\n\n/).length;
  const hasDialogue = /["「」]/.test(content);

  const quality = Math.min(10, Math.max(5, Math.floor(len / 200) + (hasTitle ? 2 : 0) + (paragraphCount > 3 ? 1 : 0)));
  const completeness = Math.min(10, Math.max(5, Math.floor(len / 150) + (hasList ? 2 : 0) + 3));
  const clarity = Math.min(10, Math.max(5, (hasTitle ? 3 : 0) + (paragraphCount > 2 ? 2 : 0) + 3));
  const actionability = Math.min(10, Math.max(5, Math.floor(len / 200) + (hasDialogue ? 1 : 0) + 3));
  const total = quality + completeness + clarity + actionability;

  return {
    scores: { quality, completeness, clarity, actionability },
    total,
    percentage: Math.round(total / 40 * 100),
    feedback: `启发式评估 (${type}): 长度=${len}, 标题=${hasTitle}, 列表=${hasList}, 段落=${paragraphCount}`,
    verdict: total >= 32 ? 'APPROVED' : total >= 24 ? 'NEEDS_REVISION' : 'POOR',
  };
}

// POST /api/scoring/evaluate — evaluate content quality
// Uses reviewer's evaluation if provided, otherwise heuristic
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, type, reviewer, group } = body;

    if (!content || !type) {
      return NextResponse.json({ error: 'content and type required' }, { status: 400 });
    }

    let result;

    if (reviewer && reviewer !== 'system') {
      // Use specified reviewer agent for evaluation
      const { chatOnce } = await import('@/lib/chat');
      const evalPrompt = `你是一个严格的质量评审员。请评估以下内容的质量。

内容类型: ${type}

内容:
${content.slice(0, 5000)}

请从以下维度评分 (每项1-10分):
1. quality — 内容质量
2. completeness — 完整性
3. clarity — 表达清晰度
4. actionability — 可执行性

请用 JSON 格式回复（不要加代码块标记）:
{"quality": N, "completeness": N, "clarity": N, "actionability": N, "feedback": "改进建议", "verdict": "APPROVED 或 NEEDS_REVISION"}`;

      try {
        const { reply } = await chatOnce(reviewer, evalPrompt, undefined, { noMcp: true });
        const jsonMatch = reply.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const eval_ = JSON.parse(jsonMatch[0]);
          const total = (eval_.quality || 5) + (eval_.completeness || 5) + (eval_.clarity || 5) + (eval_.actionability || 5);
          result = {
            scores: { quality: eval_.quality || 5, completeness: eval_.completeness || 5, clarity: eval_.clarity || 5, actionability: eval_.actionability || 5 },
            total,
            percentage: Math.round(total / 40 * 100),
            feedback: eval_.feedback || '',
            verdict: eval_.verdict || (total >= 32 ? 'APPROVED' : 'NEEDS_REVISION'),
          };
        }
      } catch (e: any) {
        console.log(`[scoring] Reviewer ${reviewer} failed: ${e.message}, falling back to heuristic`);
      }
    }

    // Fallback to heuristic if no reviewer or reviewer failed
    if (!result) {
      result = heuristicEvaluate(content, type);
    }

    // Store scoring record
    ensureDir(SCORING_DIR);
    const record = {
      id: Date.now().toString(),
      type,
      group,
      reviewer: reviewer || 'heuristic',
      scores: result.scores,
      total: result.total,
      percentage: result.percentage,
      feedback: result.feedback,
      verdict: result.verdict,
      timestamp: new Date().toISOString(),
    };

    const logFile = path.join(SCORING_DIR, `scoring-${type}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf-8');

    // Also store in learning records if group is provided
    if (group) {
      ensureDir(LEARNING_DIR);
      const learningRecord = {
        id: record.id,
        group,
        workflow: type,
        stepId: 'direct-eval',
        action: type,
        agent: reviewer || 'heuristic',
        evaluation: { ...result.scores, total: result.total, feedback: result.feedback, verdict: result.verdict },
        outputSnippet: content.slice(0, 500),
        timestamp: new Date().toISOString(),
      };
      const learningFile = path.join(LEARNING_DIR, `learning-${group}.jsonl`);
      fs.appendFileSync(learningFile, JSON.stringify(learningRecord) + '\n', 'utf-8');
    }

    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: `Scoring failed: ${e.message}` }, { status: 500 });
  }
}

// GET /api/scoring/history — view scoring history
// GET /api/scoring/history?group=<name> — view learning records for a group
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all';
  const group = searchParams.get('group');

  // If group is specified, return learning records
  if (group) {
    const learningFile = path.join(LEARNING_DIR, `learning-${group}.jsonl`);
    if (!fs.existsSync(learningFile)) {
      return NextResponse.json({ records: [], summary: { avgTotal: 0, count: 0, approved: 0, needsRevision: 0 } });
    }
    const lines = fs.readFileSync(learningFile, 'utf-8').split('\n').filter(Boolean);
    const records = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-50);

    const totals = records.map((r: any) => r.evaluation?.total || 0);
    const approved = records.filter((r: any) => r.evaluation?.verdict === 'APPROVED').length;
    const needsRevision = records.filter((r: any) => r.evaluation?.verdict === 'NEEDS_REVISION').length;
    const summary = {
      avgTotal: totals.length > 0 ? Math.round(totals.reduce((a: number, b: number) => a + b, 0) / totals.length) : 0,
      count: records.length,
      approved,
      needsRevision,
    };

    return NextResponse.json({ records, summary });
  }

  // Default: return scoring history
  ensureDir(SCORING_DIR);
  const logFile = path.join(SCORING_DIR, `scoring-${type}.jsonl`);

  if (!fs.existsSync(logFile)) {
    return NextResponse.json({ history: [] });
  }

  const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  const history = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-20);

  return NextResponse.json({ history });
}
