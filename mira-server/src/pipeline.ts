import type { WebSocket } from 'ws';
import type { ASRProvider, LLMProvider, TTSProvider, ImageProvider } from './providers/types.js';
import type { ServerMessage } from './protocol.js';
import { SYSTEM_PROMPT } from './config.js';

/**
 * Pipeline — ASR → LLM → TTS 流式编排
 *
 * 核心：turnId（epoch）取消体系
 * 1. 每次用户输入分配单调递增 turnId
 * 2. AbortController 贯穿 LLM + TTS，打断时 abort
 * 3. 已合成未下发的音频按 turnId 丢弃
 */

interface SessionState {
  sessionId: string;
  turnId: number;            // 当前活跃 turn
  history: { role: 'user' | 'assistant'; content: string }[];
  abortController: AbortController | null;
}

export class Pipeline {
  private sessions = new Map<WebSocket, SessionState>();

  constructor(
    private asr: ASRProvider,
    private llm: LLMProvider,
    private tts: TTSProvider,
    private image: ImageProvider,
  ) {}

  initSession(ws: WebSocket, sessionId: string) {
    this.sessions.set(ws, {
      sessionId,
      turnId: 0,
      history: [],
      abortController: null,
    });
  }

  getSession(ws: WebSocket): SessionState | undefined {
    return this.sessions.get(ws);
  }

  removeSession(ws: WebSocket) {
    const s = this.sessions.get(ws);
    s?.abortController?.abort();
    this.sessions.delete(ws);
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /** 打断当前 turn */
  interrupt(ws: WebSocket, turnId: number) {
    const session = this.sessions.get(ws);
    if (!session) return;
    if (session.turnId === turnId) {
      session.abortController?.abort();
      session.abortController = null;
      this.send(ws, { type: 'turn_cancelled', turnId });
    }
  }

  /**
   * 处理语音输入：接收音频流 → ASR → LLM → TTS
   */
  async handleAudioInput(
    ws: WebSocket,
    audioStream: AsyncIterable<Buffer>,
    turnId: number,
  ) {
    const session = this.sessions.get(ws);
    if (!session) return;

    // 取消上一个 turn
    session.abortController?.abort();
    session.turnId = turnId;
    const ac = new AbortController();
    session.abortController = ac;

    try {
      // 1. ASR 流式识别
      let finalText = '';
      for await (const chunk of this.asr.recognize(audioStream, ac.signal)) {
        if (session.turnId !== turnId || ac.signal.aborted) return;

        if (chunk.isFinal) {
          finalText = chunk.text;
          this.send(ws, { type: 'asr_final', turnId, text: chunk.text });
        } else {
          this.send(ws, { type: 'asr_partial', turnId, text: chunk.text });
        }
      }

      if (!finalText || ac.signal.aborted) return;

      // 2. LLM 流式生成 + 分句 TTS
      await this.runLLMAndTTS(ws, session, finalText, turnId, ac.signal);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.send(ws, {
          type: 'error',
          turnId,
          message: err.message || 'Pipeline error',
          recoverable: true,
        });
      }
    }
  }

  /**
   * 处理文字输入：跳过 ASR，直接进 LLM
   */
  async handleTextInput(
    ws: WebSocket,
    text: string,
    turnId: number,
  ) {
    const session = this.sessions.get(ws);
    if (!session) return;

    // 取消上一个 turn
    session.abortController?.abort();
    session.turnId = turnId;
    const ac = new AbortController();
    session.abortController = ac;

    try {
      this.send(ws, { type: 'asr_final', turnId, text });
      await this.runLLMAndTTS(ws, session, text, turnId, ac.signal);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.send(ws, {
          type: 'error',
          turnId,
          message: err.message,
          recoverable: true,
        });
      }
    }
  }

  /**
   * 核心：LLM 流式输出 → 分句 → TTS 并行合成 → 下发
   */
  private async runLLMAndTTS(
    ws: WebSocket,
    session: SessionState,
    userText: string,
    turnId: number,
    signal: AbortSignal,
  ) {
    // 构建消息
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      ...session.history,
      { role: 'user' as const, content: userText },
    ];

    let seq = 0;
    let dialogueText = '';

    // 分句器：LLM token 流 → 句子
    const llmStream = this.llm.chat(messages, signal, turnId);

    let buffer = '';
    const sentenceBreak = /[。！？；\n…]/;

    for await (const token of llmStream) {
      if (signal.aborted || session.turnId !== turnId) return;

      buffer += token;

      // 指令剥离：LLM 可能把指令写成 JSON（带/漏 @ 前缀、与台词同行粘连、拆成多个块）
      // 用平衡大括号提取而不是等换行——指令与台词同行时永远等不到换行，会导致整段原文泄漏进字幕
      // 只有 @{ 或 {" 开头才视为指令候选，避免台词里的杂散 { 触发无谓等待
      if (buffer.startsWith('@{') || buffer.startsWith('{"')) {
        const start = buffer[0] === '@' ? 1 : 0;
        const end = findBalancedJson(buffer, start);
        if (end === -1) continue; // JSON 还没收齐，继续积累

        let handled = false;
        try {
          const obj = JSON.parse(buffer.slice(start, end));
          if (looksLikeDirective(obj)) {
            // 剥离 media 对象顶层的 type 字段，保持 directive 消息结构
            const { type: _objType, ...directiveFields } = obj;
            // 指令先行下发
            this.send(ws, { type: 'directive', turnId, ...directiveFields });
            if (obj.media?.type === 'image' && obj.media.prompt) {
              this.generateImage(ws, turnId, obj.media.prompt, obj.media.caption || '', signal);
            } else if (obj.type === 'image' && obj.prompt) {
              // media 忘了嵌套、直接写在顶层的兜底
              this.generateImage(ws, turnId, obj.prompt, obj.caption || '', signal);
            }
            handled = true;
          }
        } catch { /* 括号平衡但非合法 JSON，按台词处理 */ }

        if (handled || start === 1) {
          // 指令块从流里剥离，不进 subtitle/TTS/history；continue 以支持连续剥离多个指令块
          buffer = buffer.slice(end);
          continue;
        }
        // 无 @ 前缀又不像指令（如把台词包进 {}）：不拦截，落到分句器当台词
      }

      // 分句（cleanDialogue 清理畸形输出里粘连的 @/{} 符号）
      let match;
      while ((match = buffer.match(sentenceBreak))) {
        const sentence = buffer.slice(0, match.index! + 1);
        buffer = buffer.slice(match.index! + 1);

        const trimmed = cleanDialogue(sentence);
        if (trimmed.length >= 2) {
          seq++;
          dialogueText += trimmed;
          // 下发字幕
          this.send(ws, {
            type: 'subtitle',
            turnId,
            seq,
            text: trimmed,
          });

          // 并行 TTS 合成（不等上一句播完）
          this.synthesizeAndSend(ws, turnId, seq, trimmed, signal);
        }
      }

      // 长句强制切
      if (buffer.length > 40) {
        seq++;
        const text = cleanDialogue(buffer);
        buffer = '';
        if (text) {
          dialogueText += text;
          this.send(ws, { type: 'subtitle', turnId, seq, text });
          this.synthesizeAndSend(ws, turnId, seq, text, signal);
        }
      }
    }

    // 剩余
    if (buffer.trim() && !signal.aborted && session.turnId === turnId) {
      seq++;
      const text = cleanDialogue(buffer);
      if (text) {
        dialogueText += text;
        this.send(ws, { type: 'subtitle', turnId, seq, text });
        this.synthesizeAndSend(ws, turnId, seq, text, signal);
      }
    }

    // 等待所有 TTS 完成（限流队列排空）
    await Promise.all(this.ttsInflight);
    this.ttsInflight = [];

    // 回合结束
    if (!signal.aborted && session.turnId === turnId) {
      // 保存历史
      session.history.push({ role: 'user', content: userText });
      if (dialogueText) {
        // history 只存纯台词（指令块已剥离、符号已清理），避免污染下一轮 LLM 上下文
        session.history.push({ role: 'assistant', content: dialogueText });
      }
      if (session.history.length > 20) {
        session.history = session.history.slice(-20);
      }

      this.send(ws, { type: 'turn_end', turnId });
    }
  }

  // TTS 并发限流器（避免 DashScope 429 限流）
  // in-flight + 等待队列 + 信号量泵
  private static readonly TTS_MAX_CONCURRENCY = 2;
  private ttsActive = 0;
  private ttsQueue: Array<() => void> = [];
  private ttsInflight: Promise<void>[] = [];

  /** 按并发上限泵取队列任务执行 */
  private pumpTTS(): void {
    while (this.ttsActive < Pipeline.TTS_MAX_CONCURRENCY && this.ttsQueue.length > 0) {
      this.ttsActive++;
      const run = this.ttsQueue.shift()!;
      run();
    }
  }

  /**
   * 合成并下发音频（限流并行，不等播完）
   * 任务先进队列，按 TTS_MAX_CONCURRENCY 信号量出队执行，
   * 防止 LLM 一气吐 N 句导致 N 个 TTS 并发触发 DashScope 429。
   */
  private synthesizeAndSend(
    ws: WebSocket,
    turnId: number,
    seq: number,
    text: string,
    signal: AbortSignal,
  ): void {
    const done = new Promise<void>((resolve) => {
      const run = async () => {
        let audioStarted = false;
        try {
          if (signal.aborted) return;

          // 下发音频开始
          audioStarted = true;
          this.send(ws, { type: 'audio_start', turnId, seq, text });

          // TTS 合成（带重试，429 限流时等待后重试）
          let audio: Buffer | null = null;
          const maxRetries = 3;
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            if (signal.aborted) break;
            try {
              audio = await this.tts.synthesize(text, signal, turnId);
              break;
            } catch (err: any) {
              if (err.name === 'AbortError' || signal.aborted) break;
              if (attempt < maxRetries - 1 && err.message?.includes('429')) {
                console.warn(`[TTS] turn=${turnId} seq=${seq} 429 限流，${(attempt + 1) * 500}ms 后重试 (${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, (attempt + 1) * 500));
                continue;
              }
              throw err;
            }
          }
          if (signal.aborted) return;
          if (!audio) {
            console.error(`[TTS] turn=${turnId} seq=${seq} 合成失败，发空帧跳过`);
            // 发空二进制帧（只有 header），让前端 AudioScheduler 能按 seq 顺序继续
            // 前端 decodeAudioData 会失败，走 error 回调 → pump 下一句
            const header = Buffer.alloc(8);
            header.writeUInt32BE(turnId, 0);
            header.writeUInt32BE(seq, 4);
            if (ws.readyState === ws.OPEN) {
              ws.send(header);
            }
            this.send(ws, { type: 'audio_end', turnId, seq });
            return;
          }

          // 下发二进制音频（前面带 8 字节 turnId + seq）
          const header = Buffer.alloc(8);
          header.writeUInt32BE(turnId, 0);
          header.writeUInt32BE(seq, 4);
          const frame = Buffer.concat([header, audio]);
          if (ws.readyState === ws.OPEN) {
            ws.send(frame);
          }

          // 下发音频结束
          this.send(ws, { type: 'audio_end', turnId, seq });
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.error(`[TTS] turn=${turnId} seq=${seq} failed:`, err.message);
          }
          // TTS 失败时必须发 audio_end，否则前端 AudioScheduler 卡死
          if (audioStarted && !signal.aborted) {
            this.send(ws, { type: 'audio_end', turnId, seq });
          }
        } finally {
          this.ttsActive--;
          this.pumpTTS();
          resolve();
        }
      };
      this.ttsQueue.push(run);
      this.pumpTTS();
    });
    this.ttsInflight.push(done);
  }

  /**
   * 异步生成图片（不阻塞 LLM/TTS 流）
   * 成功 → 下发 media_ready；失败 → 下发 media_error
   */
  private async generateImage(
    ws: WebSocket,
    turnId: number,
    prompt: string,
    caption: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const result = await this.image.synthesize(prompt, signal, turnId);
      if (!signal.aborted && session_active(ws, this.sessions, turnId)) {
        this.send(ws, { type: 'media_ready', turnId, url: result.url, caption });
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || signal.aborted) return;
      console.error(`[Image] turn=${turnId} 生成失败:`, err.message);
      if (session_active(ws, this.sessions, turnId)) {
        this.send(ws, { type: 'media_error', turnId, message: err.message || '图片生成失败' });
      }
    }
  }
}

/** 检查 session 是否仍活跃且 turnId 匹配 */
function session_active(ws: WebSocket, sessions: Map<WebSocket, SessionState>, turnId: number): boolean {
  const s = sessions.get(ws);
  return !!s && s.turnId === turnId && ws.readyState === ws.OPEN;
}

/**
 * 从 from（指向 '{'）开始扫描到平衡闭合的 '}'，返回其下一个下标；
 * 未闭合返回 -1（流式 JSON 尚未收齐）。字符串内的引号与转义不参与计数。
 */
function findBalancedJson(s: string, from: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** 解析出的对象是否携带指令字段 */
function looksLikeDirective(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return !!(o.type === 'image' || o.emotion || o.pose || o.camera || o.scene || o.fx || o.media);
}

/** 清理台词中泄漏的指令符号（LLM 畸形输出会把台词包进 {} 或带上 @） */
function cleanDialogue(text: string): string {
  return text.replace(/[@{}]/g, '').trim();
}
