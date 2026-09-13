import React from 'react';
import { useCharacterStore } from '../../store/characterStore';
import Live2DCharacter from '../Character/Live2DCharacter';
import type { Emotion } from '../../types/scene';

const EMOTION_LABELS: Record<Emotion, string> = {
  neutral: '平静',
  warm: '温暖',
  sad: '低落',
  surprised: '惊讶',
  thinking: '思考',
};

export default function CharacterLayer() {
  const { emotion, state } = useCharacterStore();
  const isThinking = state === 'thinking';

  return (
    <div className="character-rig live2d-rig">
      {/* Live2D 立绘 */}
      <Live2DCharacter />

      {/* 状态气泡 */}
      <div className={`state-bubble ${isThinking ? 'visible' : ''}`}>
        思考中…
      </div>

      {/* 调试标签 */}
      <div style={{
        position: 'absolute',
        bottom: '-24px',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '10px',
        color: 'var(--text-fade)',
        whiteSpace: 'nowrap',
        zIndex: 100,
      }}>
        {EMOTION_LABELS[emotion]}
      </div>
    </div>
  );
}
