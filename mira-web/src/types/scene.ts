// ===== 角色状态机 =====
export type CharacterState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupt'
  | 'error';

// ===== 场景指令（LLM 输出协议） =====
export type Emotion = 'neutral' | 'warm' | 'sad' | 'surprised' | 'thinking';
export type Pose = 'idle' | 'stand_idle' | 'lean_counter' | 'hold_cup' | 'look_window';
export type CameraShot = 'wide' | 'medium' | 'close';
export type SceneId = 'cafe_counter' | 'cafe_window';
export type FxType = 'thunder' | 'rain_heavy' | 'light_dim';
export type MediaEventType = 'image' | 'video' | 'none';

export interface MediaEvent {
  type: MediaEventType;
  event: string;       // 事件标识，如 "show_aurora_photo"
  prompt?: string;     // 生成式媒体的提示词
  caption?: string;    // 拍立得/卡片说明文字
  url?: string;        // 已有资源 URL（非生成式）
}

export interface SceneDirective {
  emotion: Emotion;
  pose: Pose;
  camera: CameraShot;
  scene: SceneId;
  fx: FxType[];
  media?: MediaEvent;
  branch?: string;     // 可选剧情分支标记
}

// ===== 字幕条 =====
export interface SubtitleEntry {
  id: number;
  speaker: string;
  text: string;
  turnId: number;
  status: 'pending' | 'current' | 'prev' | 'fading';
}

// ===== 会话回合 =====
export interface Turn {
  turnId: number;
  userText?: string;
  directive?: SceneDirective;
  subtitles: SubtitleEntry[];
  status: 'active' | 'cancelled' | 'completed';
}

// ===== Mock 剧本节点 =====
export interface ScriptNode {
  trigger: string;          // 用户输入关键词（mock 路由用）
  directive: SceneDirective;
  lines: { speaker: string; text: string }[];
  delayMs?: number;         // 每句之间的延迟
}
