import type { ImageProvider, ImageResult } from './types.js';
import { config } from '../config.js';

/**
 * 阿里云百炼 通义万相 文生图
 *
 * 文档：https://help.aliyun.com/zh/model-studio/text-to-image-api-reference
 *
 * 异步模式：
 *   1. POST 创建任务 → 返回 task_id
 *   2. GET 轮询 task_id → SUCCEEDED 时取 results[0].url
 *
 * 模型：wanx2.1-t2i-turbo（快速版，15-25秒）
 */
export class DashScopeImageProvider implements ImageProvider {
  constructor(
    private apiKey: string = config.dashscopeApiKey,
    private model: string = config.imageModel,
  ) {}

  async synthesize(prompt: string, signal: AbortSignal, turnId?: number): Promise<ImageResult> {
    const tid = turnId !== undefined ? `turn=${turnId} ` : '';
    console.log(`[Image] >>> 生成请求 ${tid}`);
    console.log(`[Image]     ${tid}model : ${this.model}`);
    console.log(`[Image]     ${tid}prompt: "${prompt.slice(0, 80)}"`);
    const reqStart = Date.now();

    // 1. 创建异步任务
    const createResp = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: this.model,
          input: { prompt },
          parameters: { n: 1, size: '1024*1024' },
        }),
        signal,
      }
    );

    if (!createResp.ok) {
      const errText = await createResp.text().catch(() => '(无法读取错误体)');
      console.error(`[Image] <<< 创建任务失败 ${tid}: HTTP ${createResp.status}`);
      console.error(`[Image]     ${tid}错误体: ${errText.slice(0, 300)}`);
      throw new Error(`Image API create task error: ${createResp.status}`);
    }

    const createResult: any = await createResp.json();
    const taskId = createResult?.output?.task_id;
    if (!taskId) {
      console.error(`[Image] ??? 未返回 task_id ${tid}: ${JSON.stringify(createResult).slice(0, 200)}`);
      throw new Error('Image API: no task_id returned');
    }
    console.log(`[Image]     ${tid}task_id: ${taskId}, 状态: ${createResult?.output?.task_status}`);

    // 2. 轮询任务状态
    const maxWaitMs = 60000;
    const pollIntervalMs = 2000;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      if (signal.aborted) {
        console.log(`[Image] !!! abort 触发 ${tid}，轮询中断 (耗时 ${Date.now() - reqStart}ms)`);
        throw new DOMException('Aborted', 'AbortError');
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const pollResp = await fetch(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
        {
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
          signal,
        }
      );

      if (!pollResp.ok) {
        console.warn(`[Image] ??? 轮询失败 ${tid}: HTTP ${pollResp.status}, ${pollIntervalMs}ms 后重试`);
        continue;
      }

      const pollResult: any = await pollResp.json();
      const status = pollResult?.output?.task_status;

      if (status === 'SUCCEEDED') {
        const url = pollResult?.output?.results?.[0]?.url;
        if (!url) {
          throw new Error('Image API: succeeded but no url');
        }
        console.log(`[Image] <<< 生成成功 ${tid}: ${url.slice(0, 80)} (耗时 ${Date.now() - reqStart}ms)`);
        return { url };
      }

      if (status === 'FAILED') {
        const msg = pollResult?.output?.message || 'Unknown error';
        console.error(`[Image] <<< 生成失败 ${tid}: ${msg} (耗时 ${Date.now() - reqStart}ms)`);
        throw new Error(`Image generation failed: ${msg}`);
      }

      // PENDING / RUNNING → 继续轮询
    }

    console.error(`[Image] <<< 生成超时 ${tid} (耗时 ${Date.now() - reqStart}ms)`);
    throw new Error('Image generation timeout (60s)');
  }
}
