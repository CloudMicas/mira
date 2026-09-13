import React, { useRef, useState, useCallback } from 'react';
import { useCharacterStore } from '../store/characterStore';

interface InteractionLayerProps {
  onSendText?: (text: string) => void;
  onPressStart?: () => void;
  onPressEnd?: () => void;
  onInterrupt?: () => void;
  wsStatus?: 'connecting' | 'connected' | 'disconnected';
  micSupported?: boolean;
}

export default function InteractionLayer({
  onSendText,
  onPressStart,
  onPressEnd,
  onInterrupt,
  wsStatus = 'disconnected',
  micSupported = true,
}: InteractionLayerProps) {
  const [text, setText] = useState('');
  const [pressing, setPressing] = useState(false);
  const state = useCharacterStore((s) => s.state);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pressTimer = useRef<number>();

  const isSpeaking = state === 'speaking';
  const canInterrupt = isSpeaking;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendText?.(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, onSendText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  };

  // 按住说话
  const handlePressStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (canInterrupt) {
      onInterrupt?.();
      return;
    }
    setPressing(true);
    onPressStart?.();
  }, [canInterrupt, onInterrupt, onPressStart]);

  const handlePressEnd = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (pressing) {
      setPressing(false);
      onPressEnd?.();
    }
  }, [pressing, onPressEnd]);

  // 离开/取消
  const handlePressCancel = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (pressing) {
      setPressing(false);
      onPressEnd?.();
    }
  }, [pressing, onPressEnd]);

  return (
    <div className="interaction-layer">
      {/* WS 状态指示器 */}
      {wsStatus !== 'connected' && (
        <div className="ws-status-badge">
          {wsStatus === 'connecting' ? '连接中…' : '未连接，可文字输入'}
        </div>
      )}

      {/* 麦克风不支持提示 */}
      {!micSupported && (
        <div className="ws-status-badge">
          麦克风不支持，请使用文字输入
        </div>
      )}

      {/* 文字输入 */}
      <div className="text-input-wrap">
        <textarea
          ref={textareaRef}
          className="text-input"
          placeholder={isSpeaking ? '输入文字打断…' : '和 Mira 说说…'}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!text.trim()}
          aria-label="发送"
        >
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
          </svg>
        </button>
      </div>

      {/* 按住说话 / 打断按钮 */}
      <button
        className={`mic-button ${pressing ? 'pressing' : ''} ${canInterrupt ? 'interrupt' : ''}`}
        onPointerDown={handlePressStart}
        onPointerUp={handlePressEnd}
        onPointerLeave={handlePressCancel}
        onPointerCancel={handlePressCancel}
        aria-label={canInterrupt ? '打断' : '按住说话'}
      >
        {canInterrupt ? (
          // 打断图标：方块停止
          <svg viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          // 麦克风图标
          <svg viewBox="0 0 24 24">
            <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zm5 10a5 5 0 01-10 0H5a7 7 0 006 6.92V22h2v-3.08A7 7 0 0019 12h-2z" />
          </svg>
        )}
        <span className="mic-hint">
          {canInterrupt ? '点击打断' : '按住说话'}
        </span>
      </button>
    </div>
  );
}
