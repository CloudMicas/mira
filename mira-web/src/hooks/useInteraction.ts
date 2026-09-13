/**
 * useInteraction — 集成 WS + AudioCapture + AudioScheduler + zustand
 *
 * 对外暴露：
 * 1. connect() — 连接 WS
 * 2. startSpeaking() — 按住说话开始
 * 3. stopSpeaking() — 松开，触发 ASR
 * 4. sendText(text) — 文字输入
 * 5. doInterrupt() — 打断
 * 6. wsStatus — 连接状态
 */

import { useRef, useState, useCallback } from 'react';
import { useCharacterStore } from '../store/characterStore';
import { WSClient } from '../ws/WSClient';
import { AudioCapture } from '../audio/AudioCapture';
import { AudioScheduler } from '../audio/AudioScheduler';
import type { ServerMessage } from '../ws/WSClient';

export function useInteraction() {
  const wsRef = useRef<WSClient | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const schedulerRef = useRef<AudioScheduler | null>(null);
  const currentTurnRef = useRef<number>(0);
  // 标记 capture.start() 是否仍在 await 中（用于处理快速按下松开的竞态）
  const captureStartingRef = useRef(false);

  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  // ===== 初始化（在 App 挂载时调用） =====
  const init = useCallback(() => {
    // 创建 scheduler
    if (!schedulerRef.current) {
      schedulerRef.current = new AudioScheduler();
    }

    // 创建 capture
    if (!captureRef.current) {
      captureRef.current = new AudioCapture();
    }

    // 创建 WS
    if (!wsRef.current) {
      const ws = new WSClient();

      ws.onStatus = (status) => {
        console.log(`[WS] 连接状态: ${status}`);
        setWsStatus(status);
      };

      ws.onMessage = (msg: ServerMessage) => {
        handleServerMessage(msg);
      };

      ws.onAudio = (turnId, seq, audio, text) => {
        schedulerRef.current?.enqueue(turnId, seq, audio, text);
      };

      ws.connect();
      wsRef.current = ws;
    }
  }, []);

  // ===== 处理服务端消息 =====
  const handleServerMessage = useCallback((msg: ServerMessage) => {
    const store = useCharacterStore.getState();

    // turnId 检查：丢弃迟到帧
    if (msg.turnId !== undefined && store.activeTurnId !== null && msg.turnId !== store.activeTurnId) {
      return;
    }

    switch (msg.type) {
      case 'hello':
        // 连接成功
        break;

      case 'asr_partial':
        // ASR 中间结果：可显示在输入框（暂不处理）
        break;

      case 'asr_final':
        // ASR 最终结果：进入 thinking
        useCharacterStore.getState().startThinking();
        break;

      case 'directive':
        // 场景指令：表情/动作/镜头/背景切换
        store.applyDirective({
          emotion: msg.emotion as any,
          pose: msg.pose as any,
          camera: msg.camera as any,
          scene: msg.scene as any,
          fx: msg.fx as any,
          media: msg.media as any,
        });
        // 含 image media 指令但无 url → 进入"生成中"状态
        if (msg.media?.type === 'image' && msg.media.prompt && !msg.media.url) {
          store.setMediaGenerating(true);
        }
        break;

      case 'media_ready':
        // 图片生成完成
        store.showMedia(msg.url || '', msg.caption || '');
        break;

      case 'media_error':
        // 图片生成失败
        console.error('[Media Error]', msg.message);
        store.setMediaError(msg.message || '图片生成失败');
        // 3 秒后自动清除错误
        setTimeout(() => {
          useCharacterStore.getState().hideMedia();
        }, 3000);
        break;

      case 'subtitle':
        // 字幕
        store.addSubtitle({
          speaker: 'Mira',
          text: msg.text || '',
          turnId: msg.turnId || 0,
        });
        break;

      case 'audio_start':
        // 音频开始：进入 speaking 状态
        useCharacterStore.getState().startSpeaking();
        schedulerRef.current?.setActiveTurn(msg.turnId || 0);
        break;

      case 'turn_end':
        // 回合结束
        if (useCharacterStore.getState().state === 'speaking') {
          useCharacterStore.getState().resetToIdle();
        }
        break;

      case 'turn_cancelled':
        // 被打断
        useCharacterStore.getState().cancelTurn(msg.turnId || 0);
        break;

      case 'error':
        console.error('[Server Error]', msg.message);
        if (!msg.recoverable) {
          useCharacterStore.getState().setState('error');
        }
        break;
    }
  }, []);

  // ===== 按住说话 =====
  const startSpeaking = useCallback(async () => {
    const ws = wsRef.current;
    const capture = captureRef.current;
    const scheduler = schedulerRef.current;

    if (!ws || !capture || !scheduler) {
      console.error('[Interaction] startSpeaking: ws/capture/scheduler 未初始化');
      return;
    }

    // 初始化 AudioContext（移动端需要用户手势）
    scheduler.init();
    await scheduler.resume();

    // 如果正在说话，先打断
    if (useCharacterStore.getState().state === 'speaking') {
      doInterrupt();
    }

    // 分配新 turnId
    const turnId = useCharacterStore.getState().nextTurn();
    currentTurnRef.current = turnId;
    scheduler.setActiveTurn(turnId);

    // 进入 listening
    useCharacterStore.getState().startListening();

    // 通知服务端开始
    ws.startSpeaking(turnId);
    console.log('[Interaction] audio_start 已发送, turnId=', turnId);

    // 开始采集
    captureStartingRef.current = true;
    try {
      await capture.start((pcm) => {
        ws.sendAudio(pcm);
      });
      captureStartingRef.current = false;
      console.log('[Interaction] 音频采集已启动');
    } catch (err) {
      captureStartingRef.current = false;
      console.error('[Interaction] 音频采集失败:', err);
      // 采集失败：发 interrupt 中断本轮（不能用 endSpeaking，否则会触发 ASR 结算 → NO_VALID_AUDIO_ERROR）
      ws.interrupt(turnId);
      useCharacterStore.getState().resetToIdle();
    }
  }, []);

  // ===== 松开说话 =====
  const stopSpeaking = useCallback(() => {
    const ws = wsRef.current;
    const capture = captureRef.current;

    if (!ws || !capture) return;

    // 停止采集
    capture.stop();

    // 如果 start 还在 await 中（快速按下松开），用 interrupt 避免触发 ASR 结算
    // 否则正常松开，用 endSpeaking 触发 ASR
    if (captureStartingRef.current) {
      ws.interrupt(currentTurnRef.current);
    } else {
      ws.endSpeaking(currentTurnRef.current);
    }

    // 进入 thinking
    useCharacterStore.getState().startThinking();
  }, []);

  // ===== 文字输入 =====
  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    const scheduler = schedulerRef.current;

    if (!ws || !scheduler) return;

    // 初始化 AudioContext
    scheduler.init();

    // 如果正在说话，先打断
    if (useCharacterStore.getState().state === 'speaking') {
      doInterrupt();
    }

    // 分配新 turnId
    const turnId = useCharacterStore.getState().nextTurn();
    currentTurnRef.current = turnId;
    scheduler.setActiveTurn(turnId);

    // 进入 thinking
    useCharacterStore.getState().startThinking();

    // 发送文字
    ws.sendText(text, turnId);
  }, []);

  // ===== 打断 =====
  const doInterrupt = useCallback(() => {
    const ws = wsRef.current;
    const scheduler = schedulerRef.current;

    if (!ws || !scheduler) return;

    // 1. 立即停止音频
    scheduler.interrupt(null);

    // 2. 通知服务端
    ws.interrupt(currentTurnRef.current);

    // 3. 更新状态
    useCharacterStore.getState().interrupt();

    // 3 秒后回 idle（如果用户没说话）
    setTimeout(() => {
      if (useCharacterStore.getState().state === 'interrupt') {
        useCharacterStore.getState().resetToIdle();
      }
    }, 3000);
  }, []);

  // ===== 清理 =====
  const destroy = useCallback(() => {
    captureRef.current?.stop();
    schedulerRef.current?.destroy();
    wsRef.current?.close();
  }, []);

  return {
    init,
    startSpeaking,
    stopSpeaking,
    sendText,
    doInterrupt,
    destroy,
    wsStatus,
    isSupported: AudioCapture.isSupported(),
  };
}
