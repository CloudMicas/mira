import { create } from 'zustand';
import type {
  CharacterState,
  SceneDirective,
  SubtitleEntry,
  Emotion,
  Pose,
  CameraShot,
  SceneId,
} from '../types/scene';

interface CharacterStore {
  // ===== 状态机 =====
  state: CharacterState;
  activeTurnId: number | null;

  // ===== 场景/角色 =====
  emotion: Emotion;
  pose: Pose;
  camera: CameraShot;
  scene: SceneId;
  fxActive: string[];

  // ===== 字幕 =====
  subtitles: SubtitleEntry[];

  // ===== 媒体 =====
  mediaVisible: boolean;
  mediaGenerating: boolean;
  mediaUrl: string | null;
  mediaCaption: string;
  mediaError: string | null;

  // ===== Actions =====
  setState: (s: CharacterState) => void;
  startListening: () => void;
  startThinking: () => void;
  startSpeaking: () => void;
  interrupt: () => void;
  resetToIdle: () => void;

  applyDirective: (d: SceneDirective) => void;
  addSubtitle: (s: Omit<SubtitleEntry, 'id' | 'status'>) => void;
  advanceSubtitle: () => void;
  clearSubtitles: () => void;

  showMedia: (url: string, caption: string) => void;
  setMediaGenerating: (v: boolean) => void;
  setMediaError: (msg: string | null) => void;
  hideMedia: () => void;

  nextTurn: () => number;
  cancelTurn: (turnId: number) => void;
}

let subtitleId = 0;

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  state: 'idle',
  activeTurnId: null,

  emotion: 'neutral',
  pose: 'stand_idle',
  camera: 'wide',
  scene: 'cafe_counter',
  fxActive: [],

  subtitles: [],

  mediaVisible: false,
  mediaGenerating: false,
  mediaUrl: null,
  mediaCaption: '',
  mediaError: null,

  setState: (s) => set({ state: s }),

  startListening: () =>
    set({
      state: 'listening',
      // 打断时清除旧字幕和媒体
      subtitles: get().state === 'speaking' ? [] : get().subtitles,
      mediaVisible: false,
    }),

  startThinking: () => set({ state: 'thinking' }),

  startSpeaking: () => set({ state: 'speaking' }),

  interrupt: () =>
    set((s) => ({
      state: 'interrupt',
      subtitles: [],
      mediaVisible: false,
      mediaGenerating: false,
      fxActive: [],
    })),

  resetToIdle: () =>
    set({
      state: 'idle',
      emotion: 'neutral',
      pose: 'stand_idle',
      camera: 'wide',
    }),

  applyDirective: (d) =>
    set((s) => ({
      emotion: d.emotion ?? s.emotion,
      pose: d.pose ?? s.pose,
      camera: d.camera ?? s.camera,
      scene: d.scene ?? s.scene,
      fxActive: d.fx ?? s.fxActive,
      ...(d.media?.type === 'image' && d.media.url
        ? { mediaUrl: d.media.url, mediaCaption: d.media.caption || '' }
        : {}),
    })),

  addSubtitle: (s) =>
    set((st) => ({
      subtitles: [
        ...st.subtitles.map((sub) =>
          sub.status === 'current' ? { ...sub, status: 'prev' as const } : sub
        ),
        { ...s, id: ++subtitleId, status: 'current' as const },
      ],
    })),

  advanceSubtitle: () =>
    set((st) => ({
      subtitles: st.subtitles.map((sub) => {
        if (sub.status === 'current') return { ...sub, status: 'prev' as const };
        if (sub.status === 'prev') return { ...sub, status: 'fading' as const };
        return sub;
      }),
    })),

  clearSubtitles: () => set({ subtitles: [] }),

  showMedia: (url, caption) =>
    set({ mediaVisible: true, mediaUrl: url, mediaCaption: caption, mediaGenerating: false, mediaError: null }),

  setMediaGenerating: (v) => set({ mediaGenerating: v, mediaVisible: v, mediaError: null }),

  setMediaError: (msg) => set({ mediaError: msg, mediaGenerating: false, mediaVisible: !!msg }),

  hideMedia: () => set({ mediaVisible: false, mediaGenerating: false, mediaError: null }),

  nextTurn: () => {
    const id = (get().activeTurnId ?? 0) + 1;
    set({ activeTurnId: id });
    return id;
  },

  cancelTurn: (turnId) => {
    if (get().activeTurnId === turnId) {
      set({
        subtitles: [],
        mediaVisible: false,
        mediaGenerating: false,
      });
    }
  },
}));
