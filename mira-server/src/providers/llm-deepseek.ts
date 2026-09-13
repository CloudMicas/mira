import type { LLMProvider, LLMMessage } from './types.js';

/**
 * DeepSeek LLM Provider — 兼容 OpenAI API 格式
 *
 * 文档：https://platform.deepseek.com/
 */
export class DeepSeekProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.deepseek.com',
    private model = 'deepseek-chat'
  ) {}

  async *chat(
    messages: LLMMessage[],
    signal: AbortSignal
  ): AsyncIterable<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        temperature: 0.8,
        max_tokens: 500,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${await response.text()}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (signal.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 格式解析
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch { /* skip malformed chunks */ }
      }
    }
  }
}
