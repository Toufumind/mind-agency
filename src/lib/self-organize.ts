/**
 * Self-Organization Engine
 * 
 * 让一个 Agent 自动分解任务、协调团队、选择协作模式。
 * 核心：Agent 收到目标 → 自动创建工作流 → 通知其他 Agent → 等待回调
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR } from './data-dir';

// 协作模式定义
const COLLABORATION_MODES = {
  sequential: { name: '串行流水线', description: 'A→B→C', efficiency: 'medium', quality: 'high' },
  parallel: { name: '并行+汇总', description: 'A,B,C并行→D汇总', efficiency: 'high', quality: 'high' },
  review: { name: '评审循环', description: 'A写→B评→A改', efficiency: 'medium', quality: 'very_high' },
  rapid: { name: '快速响应', description: 'A发现→B立即修复', efficiency: 'high', quality: 'medium' },
};

// 根据任务类型选择协作模式
function selectMode(taskType: string): string {
  const modeMap: Record<string, string> = {
    'novel': 'review',
    'script': 'sequential',
    'copy': 'review',
    'report': 'parallel',
    'fix': 'rapid',
    'research': 'parallel',
  };
  return modeMap[taskType] || 'sequential';
}

// 分解任务
function decomposeTask(goal: string, mode: string): Array<{step: string, agent: string, action: string}> {
  const decompositions: Record<string, Array<{step: string, agent: string, action: string}>> = {
    sequential: [
      { step: 'draft', agent: 'Alice', action: 'write' },
      { step: 'review', agent: 'Bob', action: 'review' },
      { step: 'finalize', agent: 'Charlie', action: 'finalize' },
    ],
    parallel: [
      { step: 'research-a', agent: 'Alice', action: 'research' },
      { step: 'research-b', agent: 'Bob', action: 'research' },
      { step: 'research-c', agent: 'Charlie', action: 'research' },
      { step: 'synthesize', agent: 'Alice', action: 'synthesize' },
    ],
    review: [
      { step: 'draft', agent: 'Alice', action: 'write' },
      { step: 'review', agent: 'Bob', action: 'review' },
      { step: 'revise', agent: 'Alice', action: 'revise' },
    ],
    rapid: [
      { step: 'detect', agent: 'Alice', action: 'detect' },
      { step: 'fix', agent: 'Bob', action: 'fix' },
      { step: 'verify', agent: 'Charlie', action: 'verify' },
    ],
  };
  return decompositions[mode] || decompositions.sequential;
}

export { COLLABORATION_MODES, selectMode, decomposeTask };
