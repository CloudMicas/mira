import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { TTSProvider } from './types.js';

const execAsync = promisify(exec);

/**
 * Edge TTS Provider — 零 Key 兜底方案
 *
 * 使用 edge-tts (Python) 离线预合成
 * 安装：pip install edge-tts
 */
export class EdgeTTSProvider implements TTSProvider {
  constructor(private voice = 'zh-CN-XiaoxiaoNeural') {}

  async synthesize(text: string, signal: AbortSignal, _turnId?: number): Promise<Buffer> {
    const tmpFile = join(tmpdir(), `mira_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

    try {
      // 使用 edge-tts CLI 合成
      await execAsync(
        `edge-tts --voice "${this.voice}" --text "${text.replace(/"/g, '\\"')}" --write-media "${tmpFile}"`,
        { timeout: 10000, signal }
      );

      const audio = await readFile(tmpFile);
      return audio;
    } finally {
      try { await unlink(tmpFile); } catch { /* ignore */ }
    }
  }
}

/**
 * Mock TTS — 返回空音频（前端只有字幕）
 */
export class MockTTSProvider implements TTSProvider {
  async synthesize(_text: string, _signal: AbortSignal, _turnId?: number): Promise<Buffer> {
    // 返回一个最小的有效 MP3 帧（静音）
    return Buffer.from([
      0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
  }
}
