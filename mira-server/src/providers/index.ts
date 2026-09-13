import { config } from '../config.js';
import type { ASRProvider, LLMProvider, TTSProvider, ImageProvider } from './types.js';
import { MockASRProvider } from './asr-mock.js';
import { DashScopeASRProvider } from './asr-dashscope.js';
import { MockLLMProvider } from './llm-mock.js';
import { DeepSeekProvider } from './llm-deepseek.js';
import { TongyiProvider } from './llm-tongyi.js';
import { EdgeTTSProvider, MockTTSProvider } from './tts-mock.js';
import { DashScopeTTSProvider } from './tts-dashscope.js';
import { DashScopeImageProvider } from './image-dashscope.js';

export function createASRProvider(): ASRProvider {
  if (config.mock || !config.dashscopeApiKey) return new MockASRProvider();
  return new DashScopeASRProvider(
    config.dashscopeApiKey,
    config.dashscopeWsUrl,
    config.asrModel,
  );
}

export function createLLMProvider(): LLMProvider {
  if (config.mock) return new MockLLMProvider();
  if (config.dashscopeApiKey) {
    return new TongyiProvider(
      config.dashscopeApiKey,
      config.dashscopeModel
    );
  }
  return new MockLLMProvider();
}

export function createTTSProvider(): TTSProvider {
  if (config.mock) return new MockTTSProvider();
  if (config.dashscopeApiKey) {
    return new DashScopeTTSProvider(
      config.dashscopeApiKey,
      config.dashscopeHttpUrl,
      config.ttsModel,
      config.ttsVoice,
    );
  }
  return new EdgeTTSProvider(config.edgeTtsVoice);
}

export function createImageProvider(): ImageProvider {
  if (config.mock || !config.dashscopeApiKey) {
    // mock 模式返回一个永远失败的 provider
    return {
      async synthesize(_prompt: string, _signal: AbortSignal): Promise<{ url: string }> {
        throw new Error('Image generation not available in mock mode');
      },
    };
  }
  return new DashScopeImageProvider(config.dashscopeApiKey, config.imageModel);
}
