import React, { useEffect, useRef } from 'react';
import { useCharacterStore } from '../../store/characterStore';

export default function EffectLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxActive = useCharacterStore((s) => s.fxActive);

  // 雨滴动画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf: number;
    let drops: { x: number; y: number; len: number; speed: number }[] = [];

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      drops = Array.from({ length: 80 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        len: 10 + Math.random() * 20,
        speed: 4 + Math.random() * 8,
      }));
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(180, 190, 210, 0.3)';
      ctx.lineWidth = 1;
      for (const d of drops) {
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 1, d.y + d.len);
        ctx.stroke();
        d.y += d.speed;
        if (d.y > canvas.height) {
          d.y = -d.len;
          d.x = Math.random() * canvas.width;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // 雷电触发
  useEffect(() => {
    if (fxActive.includes('thunder')) {
      const el = document.querySelector('.fx-thunder') as HTMLElement;
      if (el) {
        el.classList.remove('flash');
        void el.offsetWidth; // reflow
        el.classList.add('flash');
      }
    }
  }, [fxActive]);

  return (
    <div className="fx-layer">
      <canvas id="rain-canvas" ref={canvasRef} />
      <div className="fx-thunder" />
    </div>
  );
}
