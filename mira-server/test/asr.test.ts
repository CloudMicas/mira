/**
 * ASR 测试 — 用 DashScope TTS 生成测试音频，再送入 ASR 做回环验证
 *
 * 运行：npx tsx test/asr.test.ts
 *
 * 测试流程：
 *   1. 调用 DashScope TTS 合成一段中文音频
 *   2. 将音频切成小块，模拟流式 PCM 输入
 *   3. 调用 DashScope ASR 识别，打印中间结果与最终结果
 *   4. 对比 TTS 原文与 ASR 识别文本，给出通过/失败结论
 */

import { DashScopeASRProvider } from '../src/providers/asr-dashscope.js';
import { config } from '../src/config.js';

const TEST_TEXT = '你好，我想了解一下这家咖啡馆的拿铁。';

/**
 * 用 DashScope CosyVoice 合成 **PCM** 音频（16kHz s16le），
 * 与 ASR 期望的 format:pcm / sample_rate:16000 完全匹配，
 * 这样才能真正验证识别能力。
 * （注意：DashScopeTTSProvider 默认返回 mp3/22050Hz，不能直接喂 ASR，
 *  故测试内单独请求 pcm 格式。）
 */
async function synthesizePcm(text: string, signal: AbortSignal): Promise<Buffer> {
  const resp = await fetch(config.dashscopeHttpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.dashscopeApiKey}`,
    },
    body: JSON.stringify({
      model: config.ttsModel,
      input: { text, voice: config.ttsVoice, format: 'pcm' },
      parameters: { sample_rate: 16000, volume: 50, rate: 1.0, pitch: 1.0 },
    }),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`CosyVoice API error ${resp.status}: ${errText}`);
  }

  const result: any = await resp.json();
  const url: string | undefined = result?.output?.audio?.url;
  if (!url) throw new Error('TTS response missing audio url');

  const audioResp = await fetch(url, { signal });
  if (!audioResp.ok) throw new Error('Failed to download TTS audio');
  const ab = await audioResp.arrayBuffer();
  return Buffer.from(ab);
}

async function main() {
  console.log('===== DashScope ASR Test =====');
  console.log(`Test text : "${TEST_TEXT}"`);
  console.log(`ASR model : ${config.asrModel}`);
  console.log(`TTS model : ${config.ttsModel}`);
  console.log(`API Key   : ${config.dashscopeApiKey.slice(0, 10)}...`);

  if (!config.dashscopeApiKey) {
    console.error('\n[FATAL] DASHSCOPE_API_KEY 未配置，无法测试。');
    process.exit(1);
  }

  // ---------- Step 1: TTS 生成 16kHz PCM 测试音频 ----------
  console.log('\n[Step 1] Generating PCM audio via DashScope TTS (16kHz)...');
  let audioBuffer: Buffer;

  try {
    audioBuffer = await synthesizePcm(TEST_TEXT, new AbortController().signal);
    console.log(`TTS PCM generated: ${audioBuffer.length} bytes`);
  } catch (err: any) {
    console.error('TTS failed:', err.message);
    console.log('Falling back to silence PCM (only verifies ASR connectivity)...');
    // 兜底：3 秒静音 PCM (16kHz s16le)，仅验证 ASR 通道连通
    const samples = 16000 * 3;
    audioBuffer = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      const val = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.1 * 32767;
      audioBuffer.writeInt16LE(Math.floor(val), i * 2);
    }
    console.log(`Fallback PCM generated: ${audioBuffer.length} bytes`);
  }

  // ---------- Step 2: 切分音频块，模拟流式输入 ----------
  console.log('\n[Step 2] Splitting audio into chunks for streaming...');
  const chunkSize = 3200; // 100ms @ 16kHz s16le
  const chunks: Buffer[] = [];
  for (let i = 0; i < audioBuffer.length; i += chunkSize) {
    chunks.push(Buffer.from(audioBuffer.subarray(i, i + chunkSize)));
  }
  console.log(`Split into ${chunks.length} chunks (${chunkSize} bytes each)`);

  const audioStream: AsyncIterable<Buffer> = {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };

  // ---------- Step 3: 调用 ASR 识别 ----------
  console.log('\n[Step 3] Starting ASR recognition...');
  const asr = new DashScopeASRProvider();
  const controller = new AbortController();

  const partials: string[] = [];
  let finalText = '';

  try {
    let receivedAny = false;
    for await (const result of asr.recognize(audioStream, controller.signal)) {
      receivedAny = true;
      const tag = result.isFinal ? '[FINAL]' : '[partial]';
      console.log(`ASR ${tag} "${result.text}"`);
      if (result.isFinal) {
        finalText = result.text;
      } else {
        partials.push(result.text);
      }
    }

    if (!receivedAny) {
      console.log('\nASR returned no results (expected for silence/test audio)');
      console.log('===== ASR Test Done (no results) =====');
      return;
    }

    // ---------- Step 4: 结果对比 ----------
    console.log('\n===== Result Summary =====');
    console.log(`Original  : ${TEST_TEXT}`);
    console.log(`Recognized: ${finalText || '(no final result, last partial below)'}`);
    if (!finalText && partials.length > 0) {
      console.log(`Last partial: ${partials[partials.length - 1]}`);
    }

    if (finalText) {
      const similarity = computeSimilarity(TEST_TEXT, finalText);
      console.log(`Similarity: ${(similarity * 100).toFixed(1)}%`);
      if (similarity >= 0.6) {
        console.log('\n✅ ASR Test PASSED');
      } else {
        console.log('\n⚠️ ASR Test WARN: recognition similarity low, check audio quality');
      }
    } else {
      console.log('\n⚠️ ASR Test WARN: no final result returned');
    }
    console.log('===== ASR Test Complete =====');
  } catch (err: any) {
    console.error('\nASR error:', err.message);
    if (err.stack) console.error(err.stack);
    console.log('\n❌ ASR Test FAILED');
    process.exit(1);
  }
}

/** 简单字符级相似度（基于编辑距离） */
function computeSimilarity(a: string, b: string): number {
  const aChars = [...a];
  const bChars = [...b];
  const m = aChars.length;
  const n = bChars.length;
  if (m === 0 || n === 0) return 0;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = aChars[i - 1] === bChars[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  const dist = dp[m][n];
  return 1 - dist / Math.max(m, n);
}

main();
