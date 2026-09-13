import type { ASRProvider, ASRChunk } from './types.js';

/**
 * Mock ASR — 回放预设文本，用于零 Key 闭环
 */
export class MockASRProvider implements ASRProvider {
  async *recognize(
    audioStream: AsyncIterable<Buffer>,
    signal: AbortSignal
  ): AsyncIterable<ASRChunk> {
    // 模拟流式出字：先出部分，再出完整结果
    const mockTexts = [
      '你好',
      '你是做什么的',
      '你在等谁',
      '外面雨好大',
      '给我讲讲你的旅行',
    ];
    const text = mockTexts[Math.floor(Math.random() * mockTexts.length)];

    // 消费音频流（模拟处理时间）
    let chunkCount = 0;
    for await (const _ of audioStream) {
      chunkCount++;
      if (signal.aborted) return;

      // 每收到 3 个块出一部分
      if (chunkCount % 3 === 0) {
        const partial = text.slice(0, Math.floor(text.length * chunkCount / 10));
        yield { text: partial, isFinal: false };
      }
      if (chunkCount >= 10) break;
    }

    if (signal.aborted) return;
    yield { text, isFinal: true };
  }
}
