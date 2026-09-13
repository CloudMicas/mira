import React from 'react';
import { useCharacterStore } from '../store/characterStore';

export default function SubtitleBar() {
  const subtitles = useCharacterStore((s) => s.subtitles);
  const state = useCharacterStore((s) => s.state);

  // thinking 状态显示省略号动画
  if (state === 'thinking' && subtitles.length === 0) {
    return (
      <div className="subtitle-bar">
        <div className="subtitle-thinking">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (subtitles.length === 0) return null;

  // 只显示当前句和上一句
  const visible = subtitles
    .filter((s) => s.status !== 'fading')
    .slice(-2);

  return (
    <div className="subtitle-bar">
      {visible.map((sub) => (
        <React.Fragment key={sub.id}>
          {sub.status === 'current' && sub.speaker && (
            <div className="subtitle-speaker">{sub.speaker}</div>
          )}
          <div className={`subtitle-line ${sub.status}`}>
            {sub.text}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
