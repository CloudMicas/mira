import React, { useState } from 'react';
import { useCharacterStore } from '../../store/characterStore';

export default function MediaLayer() {
  const { mediaVisible, mediaGenerating, mediaUrl, mediaCaption, mediaError } = useCharacterStore();
  const [imgLoadError, setImgLoadError] = useState(false);

  if (!mediaVisible && !mediaGenerating && !mediaError) return null;

  return (
    <div className="media-layer">
      <div className={`media-polaroid ${(mediaVisible || mediaGenerating || mediaError) ? 'visible' : ''}`}>
        {mediaError ? (
          <div className="media-generating">
            <div className="label" style={{ color: 'var(--text-fade, #999)' }}>生成失败</div>
            <div className="caption" style={{ fontSize: '11px', marginTop: '4px' }}>{mediaError}</div>
          </div>
        ) : mediaGenerating ? (
          <div className="media-generating">
            <div className="spinner" />
            <div className="label">正在生成…</div>
          </div>
        ) : mediaUrl && !imgLoadError ? (
          <>
            <img
              src={mediaUrl}
              alt={mediaCaption}
              onError={() => setImgLoadError(true)}
            />
            <div className="caption">{mediaCaption}</div>
          </>
        ) : (
          <div className="media-generating">
            <div className="label" style={{ color: 'var(--text-fade, #999)' }}>加载失败</div>
          </div>
        )}
      </div>
    </div>
  );
}
