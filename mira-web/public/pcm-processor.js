/**
 * AudioWorkletProcessor — 采集麦克风音频并降采样到 16kHz PCM
 *
 * 浏览器原始采样率通常 44.1kHz / 48kHz
 * ASR 需要 16kHz Int16 PCM
 */

const TARGET_SAMPLE_RATE = 16000;

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._inputSampleRate = sampleRate; // 全局变量，由 AudioWorkletGlobalScope 提供
  }

  /**
   * 降采样：线性插值
   */
  downsample(input) {
    const ratio = this._inputSampleRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.floor(input.length / ratio);
    const result = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
      const fraction = srcIndex - srcIndexFloor;
      result[i] = input[srcIndexFloor] * (1 - fraction) + input[srcIndexCeil] * fraction;
    }

    return result;
  }

  /**
   * Float32 → Int16
   */
  floatToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // 取第一个通道
    const channelData = input[0];
    if (!channelData) return true;

    // 降采样
    const downsampled = this.downsample(channelData);

    // 转 Int16
    const pcmData = this.floatToInt16(downsampled);

    // 发送到主线程
    this.port.postMessage(pcmData.buffer);

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
