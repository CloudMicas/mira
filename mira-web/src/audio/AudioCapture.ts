/**
 * AudioCapture — 麦克风采集 + AudioWorklet 降采样
 *
 * 流程：getUserMedia → AudioContext → AudioWorkletNode → 16kHz PCM → WS
 */

export class AudioCapture {
  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private onChunk: ((pcm: ArrayBuffer) => void) | null = null;

  /** 按住说话：开始采集 */
  async start(onChunk: (pcm: ArrayBuffer) => void): Promise<void> {
    this.onChunk = onChunk;

    // 1. 获取麦克风
    console.log('[AudioCapture] 请求麦克风权限...');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      },
    });
    console.log('[AudioCapture] 麦克风已获取');

    // 2. 创建 AudioContext
    this.context = new AudioContext({ sampleRate: 48000 });
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    console.log('[AudioCapture] AudioContext 已创建, state=', this.context.state);

    // 3. 加载 AudioWorklet
    console.log('[AudioCapture] 加载 pcm-processor.js...');
    await this.context.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-processor.js`);
    console.log('[AudioCapture] AudioWorklet 已加载');

    // 4. 连接节点
    const source = this.context.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.context, 'pcm-processor');

    // 5. 接收 PCM 数据
    let chunkCount = 0;
    this.workletNode.port.onmessage = (e: MessageEvent) => {
      chunkCount++;
      if (chunkCount === 1) console.log('[AudioCapture] 首个 PCM 块已生成:', (e.data as ArrayBuffer).byteLength, '字节');
      if (chunkCount % 50 === 0) console.log('[AudioCapture] 已生成', chunkCount, '个 PCM 块');
      this.onChunk?.(e.data as ArrayBuffer);
    };

    source.connect(this.workletNode);
    // 不连接到 destination（不播放监听）
    console.log('[AudioCapture] 采集链路已连接');
  }

  /** 松开：停止采集 */
  stop(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.context) {
      this.context.close();
      this.context = null;
    }
    this.onChunk = null;
  }

  /** 检查浏览器是否支持 */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window.AudioContext === 'function';
  }
}
