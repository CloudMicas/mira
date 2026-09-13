/**
 * Tongyi (通义千问) LLM 测试
 *
 * 运行：npx tsx test/llm.test.ts
 *
 * 测试流程：
 *   1. 用 SYSTEM_PROMPT 跑多轮对话，验证流式输出、指令块、台词
 *   2. 测试 AbortSignal 打断（流式中断）
 */

import { TongyiProvider } from '../src/providers/llm-tongyi.js';
import { parseDirective } from '../src/protocol.js';
import { config, SYSTEM_PROMPT } from '../src/config.js';
import type { LLMMessage } from '../src/providers/types.js';

const TEST_PROMPTS = [
  '你好',
  '给我讲讲你去冰岛看极光的故事',
  '这家咖啡馆的拿铁怎么样？',
];

async function main() {
  // 支持 LLM_TEST_MODEL 覆盖（默认 qwen-plus 免费额度耗尽时可临时切换）
  const model = process.env.LLM_TEST_MODEL || config.dashscopeModel;

  console.log('===== Tongyi LLM Test =====');
  console.log(`Model  : ${model}${process.env.LLM_TEST_MODEL ? ' (overridden by LLM_TEST_MODEL)' : ''}`);
  console.log(`API Key: ${config.dashscopeApiKey.slice(0, 10)}...`);

  if (!config.dashscopeApiKey) {
    console.error('\n[FATAL] DASHSCOPE_API_KEY 未配置，无法测试。');
    process.exit(1);
  }

  const llm = new TongyiProvider(config.dashscopeApiKey, model);

  // ---------- 多轮对话 ----------
  console.log('\n[Section 1] Multi-turn conversation');
  const history: LLMMessage[] = [];
  let totalTurns = 0;
  let passedTurns = 0;

  for (const prompt of TEST_PROMPTS) {
    totalTurns++;
    console.log(`\n--- Turn ${totalTurns} | User: "${prompt}" ---`);

    const messages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: prompt },
    ];

    const turnStart = Date.now();
    let firstTokenMs = 0;
    let lastTokenMs = 0;
    let tokenCount = 0;
    let fullReply = '';

    process.stdout.write('Assistant: ');
    try {
      for await (const token of llm.chat(messages, new AbortController().signal)) {
        if (!firstTokenMs) firstTokenMs = Date.now() - turnStart;
        lastTokenMs = Date.now() - turnStart;
        tokenCount++;
        process.stdout.write(token);
        fullReply += token;
      }
    } catch (err: any) {
      console.log(`\n✗ 请求失败: ${err.message}`);
      if (err.message.includes('403')) {
        console.log(
          '\n[FATAL] qwen-plus 免费额度已耗尽。可用 LLM_TEST_MODEL=qwen-turbo 覆盖：',
        );
        console.log('  npx tsx test/llm.test.ts   # 默认');
        console.log(
          '  cross-env LLM_TEST_MODEL=qwen-turbo npm run test:llm   # Windows',
        );
        console.log('  或 PowerShell: $env:LLM_TEST_MODEL="qwen-turbo"; npm run test:llm');
        process.exit(1);
      }
      throw err;
    }
    console.log();

    // 校验
    const firstLine = fullReply.split('\n')[0];
    let directiveOk = true;
    if (firstLine.startsWith('@')) {
      const d = parseDirective(firstLine);
      if (!d) {
        directiveOk = false;
        console.log(`⚠️ 指令块解析失败: ${firstLine}`);
      } else {
        console.log(`✓ 指令块: ${JSON.stringify(d)}`);
      }
    } else {
      console.log('✓ 无指令块（SYSTEM_PROMPT 允许非剧情台词省略）');
    }

    const replyLines = fullReply.split('\n').filter((l) => l.trim());
    const sentences = fullReply
      .replace(/^@\{.*\}\n?/, '')
      .split(/[。！？\n]/)
      .filter((s) => s.trim());
    console.log(
      `Stats: tokens=${tokenCount}, first=${firstTokenMs}ms, last=${lastTokenMs}ms, lines=${replyLines.length}, sentences=${sentences.length}`,
    );

    if (tokenCount > 0 && directiveOk) {
      passedTurns++;
    }

    history.push({ role: 'user', content: prompt });
    history.push({ role: 'assistant', content: fullReply });
  }

  console.log(`\n[Section 1 Summary] ${passedTurns}/${totalTurns} turns passed`);

  // ---------- 打断测试 ----------
  console.log('\n[Section 2] Abort signal test');
  console.log('收到首 token 后 200ms 触发 abort...');

  const ac = new AbortController();
  const longMessages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: '给我详细讲讲你过去三年去过的所有地方，每个地方的故事' },
  ];

  const abortStart = Date.now();
  let abortTokens = 0;
  let abortScheduled = false;
  let timer: NodeJS.Timeout | null = null;

  let abortedSuccessfully = false;
  try {
    process.stdout.write('Assistant: ');
    for await (const token of llm.chat(longMessages, ac.signal)) {
      abortTokens++;
      process.stdout.write(token);
      // 收到首 token 后 200ms 触发 abort，确保打断发生在生成过程中
      if (!abortScheduled) {
        abortScheduled = true;
        timer = setTimeout(() => {
          ac.abort();
          console.log(
            `\n[Abort] 触发，已收到 ${abortTokens} tokens，距开始 ${Date.now() - abortStart}ms`,
          );
        }, 200);
      }
    }
    console.log(`\n[Abort] 流自然结束（未被打断），共 ${abortTokens} tokens`);
  } catch (err: any) {
    if (err.name === 'AbortError') {
      abortedSuccessfully = true;
      console.log(`\n✓ AbortError 抛出，已成功中止（${abortTokens} tokens）`);
    } else {
      console.log(`\n✗ 非预期错误: ${err.message}`);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  // 如果循环里是检测 signal.aborted 后 break（未抛 AbortError），也算成功
  if (!abortedSuccessfully && ac.signal.aborted) {
    console.log(`✓ 通过 signal.aborted 中断循环（${abortTokens} tokens）`);
    abortedSuccessfully = true;
  }

  // ---------- 总结 ----------
  console.log('\n===== Test Summary =====');
  console.log(`多轮对话  : ${passedTurns}/${totalTurns} passed`);
  console.log(`打断测试  : ${abortedSuccessfully ? '✓ passed' : '✗ failed'}`);

  if (passedTurns === totalTurns && abortedSuccessfully) {
    console.log('\n✅ Tongyi LLM Test PASSED');
  } else {
    console.log('\n⚠️ Tongyi LLM Test WARN: 部分检查未通过');
  }
  console.log('===== Test Complete =====');
}

main();
