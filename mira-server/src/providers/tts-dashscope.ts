import type { TTSProvider } from './types.js';
import { config } from '../config.js';

/**
 * 阿里云百炼 CosyVoice 语音合成
 *
 * 文档：https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api
 *
 * HTTP API（非流式，简单可靠）：
 *   POST https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer
 *   Headers: Authorization: Bearer <api_key>, Content-Type: application/json
 *   Body: { model, input: { text, voice, format } }
 */
export class DashScopeTTSProvider implements TTSProvider {
  constructor(
    private apiKey: string = config.dashscopeApiKey,
    private httpUrl: string = config.dashscopeHttpUrl,
    private model: string = config.ttsModel,
    private voice: string = config.ttsVoice,
  ) {}

  async synthesize(text: string, signal: AbortSignal, turnId?: number): Promise<Buffer> {
    const tid = turnId !== undefined ? `turn=${turnId} ` : '';
    console.log(`[TTS] >>> 合成请求 ${tid}`);
    console.log(`[TTS]     ${tid}text  : "${text}" (${text.length} 字)`);
    console.log(`[TTS]     ${tid}voice : ${this.voice}`);
    console.log(`[TTS]     ${tid}model : ${this.model}`);
    const reqStart = Date.now();

    const response = await fetch(this.httpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: {
          text,
          voice: this.voice,
          format: 'mp3',
        },
        parameters: {
          sample_rate: 22050,
          volume: 50,
          rate: 1.0,
          pitch: 1.0,
        },
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[TTS] <<< 合成失败 ${tid}: HTTP ${response.status} (耗时 ${Date.now() - reqStart}ms)`);
      console.error(`[TTS]     ${tid}错误体: ${errText.slice(0, 300)}`);
      throw new Error(`CosyVoice API error ${response.status}: ${errText}`);
    }

    // 响应是 JSON，audio 在 data.url 或 data.audio 字段
    const result: any = await response.json();

    // CosyVoice HTTP 返回格式：{ output: { audio: { url } } } 或直接返回二进制
    if (result?.output?.audio?.url) {
      // 下载音频
      const audioResp = await fetch(result.output.audio.url, { signal });
      if (!audioResp.ok) throw new Error('Failed to download TTS audio');
      const arrayBuffer = await audioResp.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      console.log(`[TTS] <<< 合成成功 ${tid}: ${buf.length} 字节 (耗时 ${Date.now() - reqStart}ms)`);
      return buf;
    }

    // 某些模型直接返回二进制
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      // JSON 格式，尝试取 url
      if (result?.data?.audio) {
        const buf = Buffer.from(result.data.audio, 'base64');
        console.log(`[TTS] <<< 合成成功 ${tid}: ${buf.length} 字节 (耗时 ${Date.now() - reqStart}ms)`);
        return buf;
      }
      console.error(`[TTS] ??? 未知响应格式 ${tid}: ${JSON.stringify(result).slice(0, 200)}`);
      throw new Error('Unexpected TTS response format');
    }

    // 直接二进制
    const arrayBuffer = await response.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    console.log(`[TTS] <<< 合成成功 ${tid}: ${buf.length} 字节 (耗时 ${Date.now() - reqStart}ms)`);
    return buf;
  }
}
