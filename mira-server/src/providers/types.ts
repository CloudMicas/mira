/**
 * Provider 抽象层 — ASR / LLM / TTS 三级可替换
 *
 * 每级都有 Mock 实现（零 Key）和真实实现
 * 每级都支持 AbortSignal（打断传播）
 */

// ========== ASR Provider ==========

export interface ASRChunk {
  text: string;
  isFinal: boolean;
}

export interface ASRProvider {
  /** 流式识别：接收二进制音频块，返回异步迭代器 */
  recognize(
    audioStream: AsyncIterable<Buffer>,
    signal: AbortSignal
  ): AsyncIterable<ASRChunk>;
}

// ========== LLM Provider ==========

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProvider {
  /** 流式对话：返回 token 异步迭代器 */
  chat(
    messages: LLMMessage[],
    signal: AbortSignal,
    turnId?: number
  ): AsyncIterable<string>;
}

// ========== TTS Provider ==========

export interface TTSProvider {
  /** 合成一句语音，返回二进制音频数据 */
  synthesize(
    text: string,
    signal: AbortSignal,
    turnId?: number
  ): Promise<Buffer>;
}

// ========== Image Provider ==========

export interface ImageResult {
  url: string;
}

export interface ImageProvider {
  /** 根据 prompt 生成图片，返回图片 URL */
  synthesize(
    prompt: string,
    signal: AbortSignal,
    turnId?: number
  ): Promise<ImageResult>;
}
