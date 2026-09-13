import React from 'react';
import { useCharacterStore } from '../store/characterStore';

const STATE_LABELS: Record<string, string> = {
  idle: '待机',
  listening: '倾听中',
  thinking: '思考中',
  speaking: '说话中',
  interrupt: '已打断',
  error: '错误',
};

export default function StatusBadge() {
  const state = useCharacterStore((s) => s.state);
  const visible = state !== 'idle';

  return (
    <div
      className={`status-badge ${visible ? 'visible' : ''}`}
      data-state={state}
    >
      <span className="dot" />
      {STATE_LABELS[state] || state}
    </div>
  );
}
