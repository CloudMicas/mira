import type { LLMProvider, LLMMessage } from './types.js';

/**
 * Mock LLM — 预写剧本，关键词路由，含场景指令
 */
export class MockLLMProvider implements LLMProvider {
  private scenarios = new Map<string, string[]>([
    ['你好', [
      '@{"emotion":"warm","pose":"idle","camera":"medium"}',
      '你也在等雨停吗？',
      '这雨一时半会儿停不了……',
      '我看过很多场雨，在冰岛、在清迈、在好多地方。',
      '@{"emotion":"warm","pose":"idle","camera":"medium"}',
      '坐吧，我请你喝杯热的。',
    ]],
    ['旅行', [
      '@{"emotion":"warm","pose":"hold_cup","camera":"close","media":{"type":"image","event":"show_aurora_photo","prompt":"polaroid photo of northern lights over iceland mountains"}}',
      '我给你看一张照片……',
      '这是去年在冰岛拍的极光。',
      '那天我在雪地里等了六个小时，冻得手都僵了。',
      '但当极光亮起来的时候，一切都值了。',
      '@{"emotion":"warm","pose":"idle","camera":"medium"}',
      '旅行教会我的是——有些东西，需要等待。',
    ]],
    ['等谁', [
      '@{"emotion":"sad","pose":"look_window","camera":"medium","scene":"cafe_window"}',
      '……等一个人。',
      '一个大概不会来的人。',
      '我们约好了，在这个咖啡馆见面。',
      '那是三年前了。',
      '@{"emotion":"sad","pose":"idle","camera":"medium"}',
      '后来我一个人走完了约定的地方。',
      '现在……只是在等雨停，然后回去。',
    ]],
    ['咖啡', [
      '@{"emotion":"warm","pose":"hold_cup","camera":"close"}',
      '这家店的拿铁不错。',
      '老板说豆子是他自己烘的，浅烘，带一点果酸。',
      '你尝尝？',
      '@{"emotion":"warm","pose":"idle","camera":"medium"}',
      '什么？不加糖？',
      '那你一定也是个行家。',
    ]],
    ['雷', [
      '@{"emotion":"surprised","pose":"idle","camera":"close","fx":["thunder"]}',
      '——！',
      '吓了一跳……',
      '我小时候最怕打雷了。',
      '@{"emotion":"warm","pose":"idle","camera":"medium"}',
      '后来走的地方多了，反而觉得雷声很……宏大。',
      '像是天空在说话。',
    ]],
  ]);

  private defaultLines = [
    '@{"emotion":"neutral","pose":"idle","camera":"medium"}',
    '嗯……',
    '雨还在下呢。',
    '你呢？你也在躲雨吗？',
  ];

  async *chat(
    messages: LLMMessage[],
    signal: AbortSignal,
    _turnId?: number
  ): AsyncIterable<string> {
    // 取最后一条 user 消息
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = lastUser?.content ?? '';

    // 关键词路由
    let lines = this.defaultLines;
    for (const [keyword, scenarioLines] of this.scenarios) {
      if (userText.includes(keyword)) {
        lines = scenarioLines;
        break;
      }
    }

    // 模拟流式输出（逐 token）
    for (const line of lines) {
      if (signal.aborted) return;
      // 整行一次性输出（实际 LLM 是逐 token 的）
      await new Promise(r => setTimeout(r, 50));
      yield line;
      // 句间停顿
      await new Promise(r => setTimeout(r, 300));
    }
  }
}
