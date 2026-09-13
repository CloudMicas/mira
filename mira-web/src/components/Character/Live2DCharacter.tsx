import { useEffect, useRef } from 'react';
import { useCharacterStore } from '../../store/characterStore';
import type { Emotion, CharacterState, Pose } from '../../types/scene';

// 全局 PIXI（通过 script 标签加载）
declare global {
  interface Window {
    PIXI: any;
  }
}

// 姿势 → Live2D 参数映射（只控制身体朝向和视线，不碰表情参数）
// 注意：ParamAngleX/Y/Z 是角度参数（范围约 -30~30），不是 0~1
const POSE_PARAMS: Partial<Record<Pose, Record<string, number>>> = {
  stand_idle: {},
  idle: {},
  lean_counter: {
    ParamAngleZ: 15,      // 身体倾斜靠吧台
    ParamAngleY: -10,     // 低头
  },
  hold_cup: {
    ParamAngleY: -8,      // 低头看杯子
    ParamEyeBallY: -0.6,  // 眼球下看
  },
  look_window: {
    ParamAngleX: -22,     // 头偏左看窗外
    ParamEyeBallX: -0.8,  // 眼球偏左
  },
};

// 姿势变化时触发的 motion（可选）
const POSE_MOTION: Partial<Record<Pose, { group: string; index: number }>> = {
  hold_cup: { group: 'Tap@Body', index: 0 },
  lean_counter: { group: 'Tap@Body', index: 0 },
};

// 情绪 → Live2D 参数映射（只控制面部表情，不碰角度参数，避免与 pose 冲突导致晃动）
const EMOTION_PARAMS: Record<Emotion, Record<string, number>> = {
  neutral: {
    ParamMouthForm: 0,
    ParamEyeLSmile: 0,
    ParamEyeRSmile: 0,
    ParamBrowLForm: 0,
    ParamBrowRForm: 0,
    ParamCheek: 0,
  },
  warm: {
    ParamMouthForm: 1,       // 满笑
    ParamEyeLSmile: 1,       // 笑眼弯弯
    ParamEyeRSmile: 1,
    ParamBrowLForm: 0.8,     // 眉毛上扬
    ParamBrowRForm: 0.8,
    ParamCheek: 0.8,         // 腮红
  },
  sad: {
    ParamMouthForm: -1,      // 嘴角下垂
    ParamEyeLSmile: 0,
    ParamEyeRSmile: 0,
    ParamBrowLForm: -1,     // 眉毛下垂
    ParamBrowRForm: -1,
    ParamCheek: 0,
  },
  surprised: {
    ParamMouthForm: 0.3,     // 嘴微张
    ParamEyeLSmile: 0,
    ParamEyeRSmile: 0,
    ParamBrowLForm: 1,       // 眉毛上挑
    ParamBrowRForm: 1,
    ParamCheek: 0.3,
  },
  thinking: {
    ParamMouthForm: -0.5,    // 嘴角微下垂
    ParamEyeLSmile: 0,
    ParamEyeRSmile: 0,
    ParamBrowLForm: -0.5,
    ParamBrowRForm: 0.3,     // 单眉微上挑（思考状）
    ParamCheek: 0,
  },
};

const STATE_MOTION: Partial<Record<CharacterState, { group: string; index: number }>> = {
  // idle 不触发 motion，让角色静止
  listening: { group: 'Tap', index: 0 },
  thinking: { group: 'Tap@Body', index: 0 },
};

export default function Live2DCharacter() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<any>(null);
  const modelRef = useRef<any>(null);

  const emotionRef = useRef<Emotion>('neutral');
  const poseRef = useRef<Pose>('stand_idle');
  const stateRef = useRef<CharacterState>('idle');
  const mouthValue = useRef(0);
  const mouthTarget = useRef(0);

  const emotion = useCharacterStore((s) => s.emotion);
  const pose = useCharacterStore((s) => s.pose);
  const state = useCharacterStore((s) => s.state);

  useEffect(() => {
    emotionRef.current = emotion;
    console.log(`[Live2D] emotion 变化: ${emotion}`);
    // emotion 变化时重启 ticker 让表情插值播放
    const app = appRef.current;
    if (app?.ticker && !app.ticker.started) {
      app.ticker.start();
    }
  }, [emotion]);

  useEffect(() => {
    poseRef.current = pose;
    console.log(`[Live2D] pose 变化: ${pose}, model 已加载: ${!!modelRef.current}`);
    // pose 变化时重启 ticker 让插值动画播放
    const app = appRef.current;
    if (app?.ticker && !app.ticker.started) {
      app.ticker.start();
    }
    // pose 变化时触发对应 motion
    const model = modelRef.current;
    if (!model) {
      console.warn('[Live2D] pose 变化但 model 未加载，motion 跳过');
      return;
    }
    const motionDef = POSE_MOTION[pose];
    if (motionDef) {
      try {
        console.log(`[Live2D] 触发 motion: ${motionDef.group}[${motionDef.index}]`);
        model.motion(motionDef.group, motionDef.index);
      } catch (e) {
        console.warn('Pose motion failed:', e);
      }
    }
  }, [pose]);

  useEffect(() => {
    stateRef.current = state;
    const model = modelRef.current;
    const app = appRef.current;

    // idle 和 interrupt 状态：停止所有 motion，停止 ticker 让角色完全冻结
    if (state === 'idle' || state === 'interrupt') {
      try {
        model?.internalModel?.motionManager?.stopAllMotions();
      } catch (e) {
        console.warn('Stop motions failed:', e);
      }
      // 停止 PIXI ticker，冻结所有渲染
      if (app?.ticker?.started) {
        app.ticker.stop();
      }
      return;
    }

    // 活跃状态：启动 ticker
    if (app?.ticker && !app.ticker.started) {
      app.ticker.start();
    }

    const motionDef = STATE_MOTION[state];
    if (motionDef && model) {
      try {
        model.motion(motionDef.group, motionDef.index);
      } catch (e) {
        console.warn('Motion failed:', e);
      }
    }
  }, [state]);

  useEffect(() => {
    let destroyed = false;

    async function init() {
      try {
        const PIXI = window.PIXI;
        if (!PIXI) {
          console.error('PIXI not loaded');
          return;
        }
        const Live2DModel = PIXI.live2d?.Live2DModel;
        if (!Live2DModel) {
          console.error('Live2DModel not loaded, PIXI.live2d =', PIXI.live2d);
          return;
        }

        Live2DModel.registerTicker(PIXI.Ticker);

        // 修复 WebGL shader 限制问题（headless/部分浏览器返回 0）
        if (PIXI.BatchShaderGenerator) {
          const orig = PIXI.BatchShaderGenerator.prototype.checkMaxIfStatementsInShader;
          PIXI.BatchShaderGenerator.prototype.checkMaxIfStatementsInShader = function() {};
        }

        // 用父容器实际尺寸，而非 window 尺寸（大屏居中限制场景）
        const containerEl = canvasRef.current?.parentElement;
        const cw = containerEl?.clientWidth || window.innerWidth;
        const ch = containerEl?.clientHeight || window.innerHeight;

        const app = new PIXI.Application({
          view: canvasRef.current,
          backgroundAlpha: 0,
          antialias: true,
          width: cw,
          height: ch,
          resolution: Math.min(window.devicePixelRatio || 1, 1.5),
          autoDensity: true,
          powerPreference: 'high-performance',
          forceFXAA: true,
        });
        appRef.current = app;
        console.log('[Live2D] PIXI app created, canvas:', canvasRef.current?.tagName, canvasRef.current?.className);

        const model = await Live2DModel.from(
          `${import.meta.env.BASE_URL}models/Hiyori/hiyori_free_t08.model3.json`
        );
        console.log('[Live2D] Model loaded:', model.name, 'size:', model.width, 'x', model.height);
        if (destroyed) {
          model.destroy();
          return;
        }

        modelRef.current = model;
        app.stage.addChild(model);

        // 关闭 Live2D 自动行为，让角色在 idle 时完全静止
        // 1. 关闭自动眨眼
        try { model.internalModel.motionManager.eyeBlinkEnabled = false; } catch {}
        // 2. 关闭自动呼吸（physics3.json 里的呼吸参数）
        try {
          const breathParams = model.internalModel?.coreModel?._model?.parameters?._parameterValues;
          if (breathParams) {
            model.internalModel.coreModel.setParameterValueById('ParamBreath', 0);
          }
        } catch {}
        // 3. 关闭鼠标自动交互
        try { model.autoInteract = false; } catch {}

        // 用 PIXI mask 裁切模型：只显示上半部分
        const maskGfx = new PIXI.Graphics();
        maskGfx.beginFill(0xffffff);
        // 只显示从顶部到 65% 高度的区域（裁掉腿）
        maskGfx.drawRect(0, 0, cw, ch * 0.65);
        maskGfx.endFill();
        app.stage.addChild(maskGfx);
        model.mask = maskGfx;

        resizeModel();
        // 不主动触发 Idle motion，让角色保持静止
        // model.motion('Idle', 0);

        app.ticker.add(() => {
          if (!modelRef.current) return;
          const m = modelRef.current;
          const core = m.internalModel?.coreModel;
          if (!core) return;

          const isSpeaking = stateRef.current === 'speaking';
          let needsAnimation = false;

          // 口型同步（仅说话时）
          if (isSpeaking) {
            needsAnimation = true;
            const t = Date.now() / 1000;
            const wave = Math.sin(t * 12) * 0.3 + Math.sin(t * 7) * 0.2;
            mouthTarget.current = 0.3 + wave + Math.random() * 0.3;
            mouthTarget.current = Math.max(0, Math.min(1, mouthTarget.current));
            mouthValue.current += (mouthTarget.current - mouthValue.current) * 0.4;
            core.setParameterValueById('ParamMouthOpenY', mouthValue.current);
          } else if (Math.abs(mouthValue.current) > 0.01) {
            needsAnimation = true;
            // 说话结束，嘴巴平滑回零
            mouthValue.current += (0 - mouthValue.current) * 0.1;
            core.setParameterValueById('ParamMouthOpenY', mouthValue.current);
          }

          // 情绪参数（只控制面部表情）
          const targetParams = EMOTION_PARAMS[emotionRef.current];
          for (const [id, target] of Object.entries(targetParams)) {
            const current = core.getParameterValueById(id);
            if (current !== undefined && current !== null) {
              const diff = Math.abs(target - current);
              if (diff > 0.005) {
                needsAnimation = true;
                const newVal = current + (target - current) * 0.04;
                core.setParameterValueById(id, newVal);
              }
            }
          }

          // 姿势参数（只控制身体朝向和视线，与 emotion 不重叠）
          const poseParams = POSE_PARAMS[poseRef.current];
          if (poseParams) {
            for (const [id, target] of Object.entries(poseParams)) {
              const current = core.getParameterValueById(id);
              if (current !== undefined && current !== null) {
                const diff = Math.abs(target - current);
                if (diff > 0.01) {
                  needsAnimation = true;
                  const newVal = current + (target - current) * 0.04;
                  core.setParameterValueById(id, newVal);
                }
              }
            }
          }

          // 所有参数已到位且不在说话 → 停止 ticker 让角色彻底静止
          if (!needsAnimation) {
            const app = appRef.current;
            if (app?.ticker?.started) {
              app.ticker.stop();
            }
          }
        });
      } catch (err) {
        console.error('Live2D init failed:', err);
      }
    }

    function resizeModel() {
      const model = modelRef.current;
      if (!model) return;
      const containerEl = canvasRef.current?.parentElement;
      const screenW = containerEl?.clientWidth || window.innerWidth;
      const screenH = containerEl?.clientHeight || window.innerHeight;

      const internalModel = model.internalModel;
      const origW = internalModel.width;
      const origH = internalModel.height;

      // 放大到容器宽度的 1.8 倍，只露到腰部
      const scale = (screenW / origW) * 1.8;
      model.scale.set(scale);

      const scaledW = origW * scale;
      const scaledH = origH * scale;

      // 靠右
      model.x = screenW - scaledW * 0.70;

      // 垂直：距顶部二分之一屏幕高度
      model.y = screenH * 0.7 - scaledH * 0.4;
    }

    // 等待脚本加载完成
    const checkReady = () => {
      if (window.PIXI?.live2d?.Live2DModel) {
        init();
      } else {
        setTimeout(checkReady, 100);
      }
    };
    checkReady();

    const onResize = () => {
      const app = appRef.current;
      const containerEl = canvasRef.current?.parentElement;
      const cw = containerEl?.clientWidth || window.innerWidth;
      const ch = containerEl?.clientHeight || window.innerHeight;
      if (app) {
        app.renderer.resize(cw, ch);
        // 更新 mask 尺寸
        const stage = app.stage;
        for (let i = 0; i < stage.children.length; i++) {
          const child = stage.children[i];
          if (child && child._geometry) {
            child.clear();
            child.beginFill(0xffffff);
            child.drawRect(0, 0, cw, ch * 0.65);
            child.endFill();
          }
        }
      }
      resizeModel();
    };
    window.addEventListener('resize', onResize);

    return () => {
      destroyed = true;
      window.removeEventListener('resize', onResize);
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
      modelRef.current = null;
    };
  }, []);

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      zIndex: 15,
      pointerEvents: 'none',
      clipPath: 'inset(0 0 0 0)',
    }}>
      <canvas
        ref={canvasRef}
        className="live2d-canvas"
        style={{
          display: 'block',
        }}
      />
    </div>
  );
}
