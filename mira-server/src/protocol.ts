/**
 * 通信协议定义 — 前后端共用
 *
 * 设计原则：
 * 1. JSON 文本帧用于控制消息，二进制帧用于音频
 * 2. 每条下行消息都带 turnId，客户端据此丢弃迟到帧
 * 3. LLM 输出的场景指令随台词流一起下发，前端指令先行
 */

// ========== 上行消息（客户端 → 服务端） ==========

export interface ClientHello {
  type: 'hello';
  sessionId?: string;       // 断线重连时携带
}

export interface ClientAudioStart {
  type: 'audio_start';
  turnId: number;           // 本次说话的 turn epoch
}

export interface ClientAudioEnd {
  type: 'audio_end';
  turnId: number;
}

export interface ClientTextInput {
  type: 'text_input';
  text: string;
  turnId: number;
}

export interface ClientInterrupt {
  type: 'interrupt';
  turnId: number;           // 要打断的 turn
}

export type ClientMessage =
  | ClientHello
  | ClientAudioStart
  | ClientAudioEnd
  | ClientTextInput
  | ClientInterrupt;

// ========== 下行消息（服务端 → 客户端） ==========

export interface ServerHello {
  type: 'hello';
  sessionId: string;
}

/** ASR 中间结果（流式出字） */
export interface ServerAsrPartial {
  type: 'asr_partial';
  turnId: number;
  text: string;
}

/** ASR 最终结果 */
export interface ServerAsrFinal {
  type: 'asr_final';
  turnId: number;
  text: string;
}

/** LLM 场景指令（先于台词到达） */
export interface ServerDirective {
  type: 'directive';
  turnId: number;
  emotion?: Emotion;
  pose?: Pose;
  camera?: Camera;
  scene?: SceneId;
  fx?: Fx[];
  media?: MediaEvent;
}

/** LLM 台词句子 */
export interface ServerSubtitle {
  type: 'subtitle';
  turnId: number;
  seq: number;              // 句子序号
  text: string;
}

/** 音频块开始 */
export interface ServerAudioStart {
  type: 'audio_start';
  turnId: number;
  seq: number;              // 对应字幕 seq
  text: string;
}

/** 音频块结束 */
export interface ServerAudioEnd {
  type: 'audio_end';
  turnId: number;
  seq: number;
}

/** 回合结束（LLM + TTS 全部完成） */
export interface ServerTurnEnd {
  type: 'turn_end';
  turnId: number;
}

/** 回合被取消（打断生效） */
export interface ServerTurnCancelled {
  type: 'turn_cancelled';
  turnId: number;
}

/** 图片生成完成 */
export interface ServerMediaReady {
  type: 'media_ready';
  turnId: number;
  url: string;
  caption: string;
}

/** 图片生成失败 */
export interface ServerMediaError {
  type: 'media_error';
  turnId: number;
  message: string;
}

/** 错误 */
export interface ServerError {
  type: 'error';
  turnId?: number;
  message: string;
  recoverable: boolean;
}

export type ServerMessage =
  | ServerHello
  | ServerAsrPartial
  | ServerAsrFinal
  | ServerDirective
  | ServerSubtitle
  | ServerAudioStart
  | ServerAudioEnd
  | ServerTurnEnd
  | ServerTurnCancelled
  | ServerMediaReady
  | ServerMediaError
  | ServerError;

// ========== 场景类型 ==========

export type Emotion = 'neutral' | 'warm' | 'sad' | 'surprised' | 'thinking';
export type Pose = 'idle' | 'lean_counter' | 'hold_cup' | 'look_window';
export type Camera = 'wide' | 'medium' | 'close';
export type SceneId = 'cafe_counter' | 'cafe_window';
export type Fx = 'thunder' | 'rain_heavy' | 'light_flicker';

export interface MediaEvent {
  type: 'image' | 'video';
  event: string;            // 剧情标记，如 'show_aurora_photo'
  prompt?: string;          // 生成提示词
  url?: string;             // 已有资源 URL
  caption?: string;         // 图片标题/说明
}

// ========== LLM 输出协议 ==========

/**
 * LLM 输出格式：首行指令块 + 正文台词
 *
 * @{"emotion":"warm","pose":"hold_cup","camera":"medium"}
 * 你也在等雨停吗？……她搅了搅杯子，抬眼看你。
 */

export interface LLMDirective {
  emotion?: Emotion;
  pose?: Pose;
  camera?: Camera;
  scene?: SceneId;
  fx?: Fx[];
  media?: MediaEvent;
}

/** 解析 LLM 输出的首行指令块 */
export function parseDirective(line: string): LLMDirective | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('@')) return null;
  try {
    const json = trimmed.slice(1);
    const obj = JSON.parse(json);
    return obj as LLMDirective;
  } catch {
    return null;
  }
}
