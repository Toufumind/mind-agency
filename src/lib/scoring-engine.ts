/**
 * Scoring Engine — 基于内容特征的真实评分
 * 
 * 6个维度, 每项10分, 总分60分, 转换为百分制
 */

interface ScoreResult {
  scores: Record<string, number>;
  total: number;
  percentage: number;
  feedback: string;
  suggestions: string[];
}

function evaluateContent(content: string, type: string): ScoreResult {
  const len = content.length;
  const hasTitle = /^#/.test(content);
  const hasEmoji = /[\u{1F600}-\u{1F64F}]/u.test(content);
  const hasList = /^[-*]\s/m.test(content) || /^\d+\.\s/m.test(content);
  const hasDialogue = /["「」]/.test(content);
  const paragraphCount = content.split(/\n\n/).length;
  const sentenceCount = content.split(/[。！？]/).length;

  // 评分逻辑
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

  // 生成改进建议
  const suggestions: string[] = [];
  if (scores.quality < 7) suggestions.push('增加具体内容和数据支撑');
  if (scores.expression < 7) suggestions.push('使用更生动的语言和修辞');
  if (scores.structure < 7) suggestions.push('添加标题和分点结构');
  if (scores.audience < 7) suggestions.push('增加emoji和互动元素');
  if (scores.originality < 7) suggestions.push('加入独特视角或故事');
  if (scores.virality < 7) suggestions.push('增加可传播的金句或标签');

  const feedback = percentage >= 90 ? '优秀，可发布' : percentage >= 70 ? '良好，需小修改' : '需改进';

  return { scores, total, percentage, feedback, suggestions };
}

export { evaluateContent };
export type { ScoreResult };
