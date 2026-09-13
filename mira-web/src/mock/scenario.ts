import type { ScriptNode } from '../types/scene';

// Mock 剧本：关键词路由到不同分支
export const SCRIPT: ScriptNode[] = [
  {
    trigger: '你好|嗨|hi|hello|你是谁',
    directive: {
      emotion: 'warm',
      pose: 'lean_counter',
      camera: 'medium',
      scene: 'cafe_counter',
      fx: [],
      media: { type: 'none', event: '' },
    },
    lines: [
      { speaker: 'Mira', text: '嗯……你也来得巧，这店再过半小时就关门了。' },
      { speaker: 'Mira', text: '我叫 Mira，刚从冰岛回来。你呢？也是躲雨进来的？' },
    ],
    delayMs: 1500,
  },
  {
    trigger: '旅行|travel|照片|冰岛|极光',
    directive: {
      emotion: 'surprised',
      pose: 'hold_cup',
      camera: 'close',
      scene: 'cafe_counter',
      fx: [],
      media: {
        type: 'image',
        event: 'show_aurora_photo',
        prompt: 'polaroid photo of aurora borealis over icelandic landscape',
        caption: '极光 · Vík, 冰岛',
      },
    },
    lines: [
      { speaker: 'Mira', text: '你问极光？等等——' },
      { speaker: 'Mira', text: '你看这张，是我在 Vík 的黑沙滩上拍的。' },
      { speaker: 'Mira', text: '那天零下十五度，等了四个小时，但……值了。' },
    ],
    delayMs: 2000,
  },
  {
    trigger: '等谁|等人|朋友|一个人',
    directive: {
      emotion: 'sad',
      pose: 'look_window',
      camera: 'medium',
      scene: 'cafe_window',
      fx: ['thunder'],
      media: { type: 'none', event: '' },
    },
    lines: [
      { speaker: 'Mira', text: '……' },
      { speaker: 'Mira', text: '你注意到了。' },
      { speaker: 'Mira', text: '他说雨停了就到。可这雨……从下午开始就没停过。' },
    ],
    delayMs: 1800,
  },
  {
    trigger: '咖啡|喝什么|饮料',
    directive: {
      emotion: 'neutral',
      pose: 'hold_cup',
      camera: 'medium',
      scene: 'cafe_counter',
      fx: [],
      media: { type: 'none', event: '' },
    },
    lines: [
      { speaker: 'Mira', text: '美式。这家的豆子不错，酸度刚好。' },
      { speaker: 'Mira', text: '老板说快打烊了，给我续了最后一杯。' },
    ],
    delayMs: 1200,
  },
  {
    trigger: '雷|闪电|雨|storm',
    directive: {
      emotion: 'surprised',
      pose: 'stand_idle',
      camera: 'wide',
      scene: 'cafe_window',
      fx: ['thunder', 'rain_heavy'],
      media: { type: 'none', event: '' },
    },
    lines: [
      { speaker: 'Mira', text: '又打雷了。' },
      { speaker: 'Mira', text: '我最喜欢暴雨的夜晚。感觉整个城市都被洗了一遍。' },
    ],
    delayMs: 1500,
  },
];

// 默认回复
export const DEFAULT_NODE: ScriptNode = {
  trigger: '',
  directive: {
    emotion: 'neutral',
    pose: 'stand_idle',
    camera: 'medium',
    scene: 'cafe_counter',
    fx: [],
    media: { type: 'none', event: '' },
  },
  lines: [
    { speaker: 'Mira', text: '嗯，我在听。你继续说。' },
  ],
  delayMs: 1000,
};

export function findScriptNode(input: string): ScriptNode {
  const lower = input.toLowerCase();
  for (const node of SCRIPT) {
    if (node.trigger.split('|').some((kw) => lower.includes(kw))) {
      return node;
    }
  }
  return DEFAULT_NODE;
}
