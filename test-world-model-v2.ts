import { getAgency } from './src/lib/agency';

async function main() {
  const agency = getAgency();
  process.stderr.write('=== 使用 Agency 执行任务 ===\n\n');

  // Step 1: Alice 研究世界模型
  process.stderr.write('Step 1: Alice 研究世界模型...\n');
  const alice = agency.getAgent('Alice');
  const research = await alice.chat(`研究世界模型的核心概念，包括：
1. 什么是世界模型（World Model）
2. 世界模型的历史发展
3. 世界模型在 AI 中的应用
4. 世界模型的关键论文和作者

输出格式：结构化的研究报告`);
  process.stderr.write('Alice 的研究完成\n\n');

  // Step 2: Bob 设计大纲
  process.stderr.write('Step 2: Bob 设计教程大纲...\n');
  const bob = agency.getAgent('Bob');
  const outline = await bob.chat(`基于以下研究设计教程大纲：

${research.reply}

要求：
1. 教程目标：让大一学生理解世界模型
2. 教程结构：从基础到进阶
3. 每章的学习目标和内容概要
4. 推荐的阅读材料

输出格式：详细的教程大纲`);
  process.stderr.write('Bob 的大纲完成\n\n');

  // Step 3: Alice 写第一章
  process.stderr.write('Step 3: Alice 写第一章...\n');
  const chapter1 = await alice.chat(`撰写第一章：什么是世界模型

要求：
1. 用简单易懂的语言解释概念
2. 举生活中的例子
3. 与大一学生已知的知识联系
4. 只用往下看就能明白，不需要前置知识

输出：完整的第一章内容`);
  process.stderr.write('第一章完成\n\n');

  // Step 4: Bob 写第二章
  process.stderr.write('Step 4: Bob 写第二章...\n');
  const chapter2 = await bob.chat(`撰写第二章：世界模型的历史

要求：
1. 从早期 AI 到现代深度学习
2. 关键里程碑和突破
3. 重要人物和贡献
4. 故事化叙述，引人入胜

输出：完整的第二章内容`);
  process.stderr.write('第二章完成\n\n');

  // Step 5: Alice 写第三章
  process.stderr.write('Step 5: Alice 写第三章...\n');
  const chapter3 = await alice.chat(`撰写第三章：世界模型的应用

要求：
1. 游戏 AI（AlphaGo, OpenAI Five）
2. 自动驾驶
3. 机器人控制
4. 语言模型
5. 用实际案例说明

输出：完整的第三章内容`);
  process.stderr.write('第三章完成\n\n');

  // Step 6: Bob 审阅
  process.stderr.write('Step 6: Bob 审阅...\n');
  const review = await bob.chat(`审阅以下教程内容：

第一章：${chapter1.reply.slice(0, 500)}...

第二章：${chapter2.reply.slice(0, 500)}...

第三章：${chapter3.reply.slice(0, 500)}...

要求：
1. 检查内容准确性
2. 检查难度是否适合大一学生
3. 检查是否满足"只用往下看就能明白"的要求
4. 提出改进建议

输出：审阅报告和修改建议`);
  process.stderr.write('审阅完成\n\n');

  // 输出最终教程
  process.stderr.write('\n=== 教程完成 ===\n');
  process.stderr.write('\n--- 第一章 ---\n');
  process.stderr.write(chapter1.reply);
  process.stderr.write('\n\n--- 第二章 ---\n');
  process.stderr.write(chapter2.reply);
  process.stderr.write('\n\n--- 第三章 ---\n');
  process.stderr.write(chapter3.reply);
  process.stderr.write('\n\n--- 审阅报告 ---\n');
  process.stderr.write(review.reply);
}

main().catch(e => process.stderr.write('Error: ' + e.message + '\n'));
