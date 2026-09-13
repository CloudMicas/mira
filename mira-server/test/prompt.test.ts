/**
 * 验证 SYSTEM_PROMPT —— 多种问法是否给出对应的、合理的回答
 */
import { TongyiProvider } from '../src/providers/llm-tongyi.js';
import { config, SYSTEM_PROMPT } from '../src/config.js';

const CASES = [
  '你好',
  '你是谁？',
  '这家咖啡馆的拿铁怎么样？',
  '你去过哪些地方旅行？',
  '你在等谁？',
];

async function main() {
  const llm = new TongyiProvider(config.dashscopeApiKey, config.dashscopeModel);
  for (const q of CASES) {
    const msgs = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: q },
    ];
    let out = '';
    for await (const t of llm.chat(msgs, new AbortController().signal)) out += t;
    console.log(`\n--- Q: ${q} ---`);
    console.log(out);
  }
}
main();
