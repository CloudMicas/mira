/**
 * WSClient — WebSocket 客户端
 *
 * 功能：
 * 1. 自动重连（指数退避）
 * 2. sessionId 恢复
 * 3. 消息分发到回调
 * 4. 二进制音频帧解析（turnId + seq 头）
 */

export interface ServerMessage {
  type: string;
  turnId?: number;
  seq?: number;
  text?: string;
  emotion?: string;
  pose?: string;
  camera?: string;
  scene?: string;
  fx?: string[];
  media?: { type: string; event: string; prompt?: string; url?: string; caption?: string };
  url?: string;
  caption?: string;
  message?: string;
  recoverable?: boolean;
  sessionId?: string;
}

type MessageHandler = (msg: ServerMessage) => void;
type AudioHandler = (turnId: number, seq: number, audio: ArrayBuffer, text: string) => void;
type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected') => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnect = 5;
  private shouldReconnect = true;

  onMessage: MessageHandler | null = null;
  onAudio: AudioHandler | null = null;
  onStatus: StatusHandler | null = null;

  constructor(url?: string) {
    // 自动检测：开发环境连本地，生产环境同源
    // WS 路径跟随部署 base（'/' → /ws，'/mira/' → /mira/ws），与静态资源保持一致
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = url || `${proto}//${location.host}${import.meta.env.BASE_URL}ws`;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.onStatus?.('connecting');

    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStatus?.('connected');
      console.log('[WS] Connected');

      // 发送 hello（断线重连带 sessionId）
      this.send({ type: 'hello', sessionId: this.sessionId || undefined });
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        // JSON 消息
        try {
          const msg = JSON.parse(event.data) as ServerMessage;

          // 保存 sessionId
          if (msg.type === 'hello' && msg.sessionId) {
            this.sessionId = msg.sessionId;
          }

          // TTS 相关消息日志
          if (msg.type === 'audio_start' || msg.type === 'audio_end') {
            console.log(`[WS] <<< ${msg.type} turnId=${msg.turnId} seq=${msg.seq} text="${msg.text ?? ''}"`);
          } else if (msg.type === 'subtitle') {
            console.log(`[WS] <<< subtitle turnId=${msg.turnId} seq=${msg.seq} text="${msg.text ?? ''}"`);
          } else if (msg.type === 'directive') {
            const parts: string[] = [];
            if (msg.emotion) parts.push(`emotion=${msg.emotion}`);
            if (msg.pose) parts.push(`pose=${msg.pose}`);
            if (msg.camera) parts.push(`camera=${msg.camera}`);
            if (msg.scene) parts.push(`scene=${msg.scene}`);
            if (msg.fx?.length) parts.push(`fx=[${msg.fx.join(',')}]`);
            if (msg.media) parts.push(`media=${JSON.stringify(msg.media)}`);
            console.log(`[WS] <<< directive turnId=${msg.turnId} ${parts.join(' ')}`);
          } else if (msg.type === 'media_ready') {
            console.log(`[WS] <<< media_ready turnId=${msg.turnId} url="${msg.url?.slice(0, 60)}..." caption="${msg.caption}"`);
          } else if (msg.type === 'media_error') {
            console.log(`[WS] <<< media_error turnId=${msg.turnId} message="${msg.message}"`);
          }

          this.onMessage?.(msg);
        } catch {
          console.error('[WS] Failed to parse message');
        }
      } else if (event.data instanceof ArrayBuffer) {
        // 二进制音频帧：前 8 字节 = turnId(4) + seq(4)
        const buf = event.data as ArrayBuffer;
        const header = new DataView(buf, 0, 8);
        const turnId = header.getUint32(0);
        const seq = header.getUint32(4);
        const audio = buf.slice(8);

        console.log(`[WS] <<< audio_frame turnId=${turnId} seq=${seq} bytes=${audio.byteLength}${audio.byteLength === 0 ? ' (空帧)' : ''}`);

        this.onAudio?.(turnId, seq, audio, '');
      }
    };

    this.ws.onclose = () => {
      this.onStatus?.('disconnected');
      console.log('[WS] Disconnected');

      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnect) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        setTimeout(() => this.connect(), delay);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** 发送二进制音频 */
  sendAudio(pcm: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm);
    }
  }

  /** 通知开始说话 */
  startSpeaking(turnId: number): void {
    this.send({ type: 'audio_start', turnId });
  }

  /** 通知结束说话 */
  endSpeaking(turnId: number): void {
    this.send({ type: 'audio_end', turnId });
  }

  /** 发送文字输入 */
  sendText(text: string, turnId: number): void {
    this.send({ type: 'text_input', text, turnId });
  }

  /** 发送打断 */
  interrupt(turnId: number): void {
    this.send({ type: 'interrupt', turnId });
  }

  /** 关闭连接 */
  close(): void {
    this.shouldReconnect = false;
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
