/**
 * AudioScheduler — 音频播放调度器
 *
 * 核心机制：
 * 1. turnId（epoch）双重检查：入口丢弃 + commit 前二次校验
 * 2. 按 seq 顺序播放（乱序到达暂存 pending）
 * 3. gapless 无缝衔接
 * 4. 打断时立即停止 + 清空队列
 */

interface AudioItem {
  seq: number;
  buffer: ArrayBuffer;
  turnId: number;
  text: string;
}

type SentenceStartCallback = (item: AudioItem) => void;
type TurnEndCallback = () => void;

export class AudioScheduler {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;

  private queue: AudioItem[] = [];
  private pending: Map<number, AudioItem> = new Map();
  private playing = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private lastSeq = 0;  // 最后入队的 seq，队列空时从这里续

  activeTurnId: number | null = null;

  onSentenceStart: SentenceStartCallback | null = null;
  onTurnEnd: TurnEndCallback | null = null;

  /** 初始化 AudioContext（必须在用户手势内调用） */
  init(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  /** 解锁 AudioContext（移动端自动播放限制） */
  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /** 获取实时音量（用于口型同步） */
  getRMS(): number {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }

  /**
   * 接收音频帧（从 WS onmessage 调用）
   *
   * @param turnId 回合 ID
   * @param seq 句子序号
   * @param audioData 音频二进制
   * @param text 字幕文本
   */
  enqueue(turnId: number, seq: number, audioData: ArrayBuffer, text: string): void {
    // ★ 检查点1：入口丢弃迟到帧
    if (this.activeTurnId !== null && turnId !== this.activeTurnId) {
      console.warn(`[AudioScheduler] 丢弃迟到帧 turnId=${turnId} seq=${seq}（当前 turn=${this.activeTurnId}）`);
      return;
    }

    const item: AudioItem = { seq, buffer: audioData, turnId, text };
    this.pending.set(seq, item);
    this.tryDequeue();

    // 收到 TTS 音频：入队顺序正常 / 乱序暂存 pending / 已直接可播
    if (this.pending.has(seq)) {
      const expectSeq = this.queue.length > 0 ? this.queue[this.queue.length - 1].seq + 1 : this.lastSeq + 1;
      console.log(`[AudioScheduler] 收到音频 seq=${seq} bytes=${audioData.byteLength} → 暂存 pending（乱序，等待 seq=${expectSeq}）`);
    } else {
      console.log(`[AudioScheduler] 收到音频 seq=${seq} bytes=${audioData.byteLength} → 已入队`);
    }

    this.pump();
  }

  /**
   * 尝试按 seq 顺序从 pending 补充到 queue（循环取出所有连续项）
   * 注意：不调 pump，由调用方负责
   */
  private tryDequeue(): void {
    while (true) {
      const nextSeq = this.queue.length > 0
        ? this.queue[this.queue.length - 1].seq + 1
        : this.lastSeq + 1;

      const item = this.pending.get(nextSeq);
      if (!item) break;

      this.pending.delete(nextSeq);
      this.queue.push(item);
      this.lastSeq = nextSeq;
    }
  }

  /**
   * 播放调度器：取队首播放，结束后继续
   */
  private pump(): void {
    // 先尝试从 pending 补充 queue（处理乱序到达：后句先到时卡在 pending）
    this.tryDequeue();

    if (this.playing || !this.ctx || this.queue.length === 0) return;

    const next = this.queue.shift()!;

    // ★ 检查点2：commit 前二次校验
    if (this.activeTurnId !== null && next.turnId !== this.activeTurnId) {
      this.pump();
      return;
    }

    this.playing = true;

    // 解码音频
    this.ctx.decodeAudioData(
      next.buffer.slice(0),
      (audioBuffer) => {
        if (this.activeTurnId !== null && next.turnId !== this.activeTurnId) {
          this.playing = false;
          this.pump();
          return;
        }

        const source = this.ctx!.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.gain!);

        // 字幕钩子：句级字幕天然同步
        this.onSentenceStart?.(next);

        console.log(`[AudioScheduler] 播放 turnId=${next.turnId} seq=${next.seq} 时长=${audioBuffer.duration.toFixed(2)}s 采样率=${audioBuffer.sampleRate}Hz${next.text ? ` text="${next.text}"` : ''}`);

        source.onended = () => {
          this.playing = false;
          this.currentSource = null;
          // 播完一句后先从 pending 补充，再继续 pump
          this.tryDequeue();
          this.pump();
        };

        this.currentSource = source;
        source.start();
      },
      (err) => {
        console.error('[AudioScheduler] decode error:', err);
        this.playing = false;
        this.tryDequeue();
        this.pump();
      }
    );
  }

  /**
   * 打断：立即停止播放 + 清空队列
   */
  interrupt(newTurnId: number | null): void {
    this.activeTurnId = newTurnId;
    this.queue = [];
    this.pending.clear();
    this.lastSeq = 0;

    if (this.currentSource) {
      try { this.currentSource.stop(); } catch {}
      this.currentSource = null;
    }
    this.playing = false;
  }

  /** 设置当前 turn（幂等：同一 turnId 不重置 seq，避免 per-sentence 的 audio_start 把 lastSeq 清零导致后续帧卡死） */
  setActiveTurn(turnId: number): void {
    if (this.activeTurnId === turnId) return;  // 同一 turn，不重置
    this.activeTurnId = turnId;
    this.lastSeq = 0;  // 新 turn 重置 seq 计数
  }

  /** 是否正在播放 */
  get isPlaying(): boolean {
    return this.playing;
  }

  /** 清空所有状态 */
  reset(): void {
    this.queue = [];
    this.pending.clear();
    this.activeTurnId = null;
    this.lastSeq = 0;
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch {}
      this.currentSource = null;
    }
    this.playing = false;
  }

  /** 销毁 */
  destroy(): void {
    this.reset();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
