import React from 'react';
import { useCharacterStore } from '../../store/characterStore';

// 用 BASE_URL 拼接，兼容 base: '/' 与 base: '/mira/' 两种部署路径
const BG_IMAGES: Record<string, string> = {
  cafe_counter: `${import.meta.env.BASE_URL}assets/background/bg_cafe_counter.png`,
  cafe_window: `${import.meta.env.BASE_URL}assets/background/bg_cafe_window.png`,
};

export default function BackgroundLayer() {
  const scene = useCharacterStore((s) => s.scene);

  return (
    <div className="bg-layer">
      {/* 背景图交叉淡化 */}
      {Object.entries(BG_IMAGES).map(([key, src]) => (
        <div
          key={key}
          className="bg-image"
          style={{
            backgroundImage: `url(${src})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: scene === key ? 1 : 0,
            transition: 'opacity 1s ease',
          }}
        />
      ))}

      {/* 渐变遮罩 */}
      <div className="bg-gradient" />
      <div className="bg-vignette" />
    </div>
  );
}
