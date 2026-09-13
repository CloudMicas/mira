import type { LLMProvider, LLMMessage } from './types.js';

/**
 * 通义千问 LLM Provider (DashScope API)
 *
 * 文档：https://help.aliyun.com/zh/dashscope/
 */
export class TongyiProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private model = 'qwen-plus'
  ) {}

  async *chat(
    messages: LLMMessage[],
    signal: AbortSignal,
    turnId?: number
  ): AsyncIterable<string> {
    // ===== 输入日志 =====
    const tid = turnId !== undefined ? `turn=${turnId} ` : '';
    const msgCount = messages.length;
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    console.log(`[LLM] >>> 请求开始 ${tid}`);
    console.log(`[LLM]     ${tid}model    : ${this.model}`);
    console.log(`[LLM]     ${tid}messages : ${msgCount} 条`);
    console.log(`[LLM]     ${tid}last user: "${lastUser?.content?.slice(0, 80) ?? '(无)'}"`);
    const reqStart = Date.now();
    let firstTokenMs = 0;
    let tokenCount = 0;
    let fullOutput = '';

    const response = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'X-DashScope-SSE': 'enable',
        },
        body: JSON.stringify({
          model: this.model,
          input: { messages },
          parameters: {
            result_format: 'message',
            incremental_output: true,
            temperature: 0.9,
          },
        }),
        signal,
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '(无法读取错误体)');
      console.error(`[LLM] <<< 请求失败 ${tid}: HTTP ${response.status} ${response.statusText}`);
      console.error(`[LLM]     ${tid}错误体: ${errText.slice(0, 300)}`);
      throw new Error(`DashScope API error: ${response.status}`);
    }

    console.log(`[LLM] <<< 流开始 ${tid}(HTTP ${response.status})`);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (signal.aborted) {
        console.log(`[LLM] !!! abort 触发 ${tid}，流中断 (已收到 ${tokenCount} tokens, 耗时 ${Date.now() - reqStart}ms)`);
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        console.log(`[LLM] <<< 流自然结束 ${tid}(共 ${tokenCount} tokens, 首 token ${firstTokenMs}ms, 总耗时 ${Date.now() - reqStart}ms)`);
        console.log(`[LLM]     ${tid}完整输出: "${fullOutput.slice(0, 120)}${fullOutput.length > 120 ? '...' : ''}"`);
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // SSE 格式解析（DashScope 增量输出）
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') {
          if (data === '[DONE]') console.log(`[LLM] <<< 收到 [DONE] 标记 ${tid}`);
          continue;
        }

        try {
          const json = JSON.parse(data);
          const content = json.output?.choices?.[0]?.message?.content;
          if (content) {
            if (!firstTokenMs) {
              firstTokenMs = Date.now() - reqStart;
              console.log(`[LLM] >>> 首 token 到达 ${tid}(${firstTokenMs}ms): "${content}"`);
            }
            tokenCount++;
            fullOutput += content;
            yield content;
          }
        } catch (e: any) {
          console.error(`[LLM] ??? SSE 解析失败 ${tid}: ${(e as Error).message}, data="${data.slice(0, 100)}"`);
        }
      }
    }

    if (!tokenCount && !signal.aborted) {
      console.warn(`[LLM] !!! 流结束但未收到任何 token ${tid}(耗时 ${Date.now() - reqStart}ms)`);
    }
  }
}
