import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import type { ASRProvider, ASRChunk } from './types.js';
import { config } from '../config.js';

/**
 * 阿里云百炼 Paraformer 实时语音识别
 *
 * 协议参考：
 *   客户端事件：https://help.aliyun.com/zh/model-studio/paraformer-client-events
 *   服务端事件：https://help.aliyun.com/zh/model-studio/paraformer-server-events
 *
 * 交互流程：
 * 1. 建立 WebSocket 连接（header 带 Authorization）
 * 2. 发送 run-task 事件 → 收到 task-started
 * 3. 发送音频帧（二进制）→ 收到 result-generated
 * 4. 发送 finish-task 事件 → 收到 task-finished
 */
export class DashScopeASRProvider implements ASRProvider {
  constructor(
    private apiKey: string = config.dashscopeApiKey,
    private wsUrl: string = config.dashscopeWsUrl,
    private model: string = config.asrModel,
  ) {}

  async *recognize(
    audioStream: AsyncIterable<Buffer>,
    signal: AbortSignal
  ): AsyncIterable<ASRChunk> {
    const taskId = randomUUID();

    const ws = new WebSocket(this.wsUrl, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    const events: any[] = [];
    let resolveWait: (() => void) | null = null;
    let taskStarted = false;
    let taskFinished = false;
    let taskFailed = false;
    let errorMsg: string | null = null;

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        events.push(msg);

        const event = msg.header?.event;
        if (event === 'task-started') {
          taskStarted = true;
        } else if (event === 'task-finished') {
          taskFinished = true;
        } else if (event === 'task-failed') {
          taskFailed = true;
          errorMsg = msg.header?.error_message || 'ASR task failed';
        }
        resolveWait?.();
        resolveWait = null;
      } catch { /* ignore */ }
    });

    ws.on('error', (err) => {
      errorMsg = err.message;
      taskFailed = true;
      resolveWait?.();
      resolveWait = null;
    });

    // 1. 等待连接
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ASR connect timeout')), 10000);
      ws.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // 2. 发送 run-task（带完整的 payload 结构）
    ws.send(JSON.stringify({
      header: {
        action: 'run-task',
        task_id: taskId,
        streaming: 'duplex',
      },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: this.model,
        parameters: {
          format: 'pcm',
          sample_rate: 16000,
          disfluency_removal_enabled: false,
          language_hints: ['zh', 'en'],
        },
        input: {},
      },
    }));

    // 3. 等待 task-started
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (taskStarted) return resolve();
        if (taskFailed) return reject(new Error(errorMsg || 'ASR task failed'));
        resolveWait = check;
      };
      check();
    });

    console.log(`[ASR] Task started: ${taskId}`);

    // abort 时唤醒接收循环，让它检查 signal.aborted 并退出
    // 注意：不主动 close WS，让 sendLoop 自然发 finish-task 收尾，
    // 否则 DashScope 端任务会悬挂，且 pipeline 拿不到 final 导致不进 LLM
    const onAbort = () => {
      console.log(`[ASR] !!! abort 触发 (task=${taskId.slice(0, 8)})`);
      resolveWait?.();
      resolveWait = null;
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });

    // 4. 发送音频帧 + 接收结果
    // abort 时让 sendLoop 立即退出（不等 audioStream 自然结束），
    // 否则旧 turn 的 audioStream 永远不结束 → sendLoop 永挂 → WS 永不关闭
    let totalBytesSent = 0;
    let chunkCount = 0;
    const sendLoop = (async () => {
      const iter = audioStream[Symbol.asyncIterator]();
      let aborted = false;
      const onAbortSend = () => { aborted = true; };
      signal.addEventListener('abort', onAbortSend, { once: true });

      try {
        while (!aborted) {
          if (ws.readyState !== ws.OPEN) {
            console.log(`[ASR] sendLoop: WS 已关闭，退出 (task=${taskId.slice(0, 8)})`);
            break;
          }
          // race audioStream chunk 和 abort，避免 for-await 阻塞在空 queue 上
          const next = iter.next();
          const abortPromise = new Promise<IteratorResult<Buffer>>((resolve) => {
            if (aborted) return resolve({ done: true, value: undefined as any });
            signal.addEventListener('abort', () => resolve({ done: true, value: undefined as any }), { once: true });
          });
          const result = await Promise.race([next, abortPromise]);
          if (result.done) {
            if (aborted) console.log(`[ASR] sendLoop: abort 退出 (task=${taskId.slice(0, 8)}, 已发 ${chunkCount} 帧 ${totalBytesSent} 字节)`);
            else console.log(`[ASR] sendLoop: 流结束退出 (task=${taskId.slice(0, 8)}, 已发 ${chunkCount} 帧 ${totalBytesSent} 字节)`);
            break;
          }

          if (signal.aborted) break;
          ws.send(result.value);
          chunkCount++;
          totalBytesSent += result.value.length;
          if (chunkCount === 1) console.log(`[ASR] sendLoop: 首帧音频已发送 (${result.value.length} 字节, task=${taskId.slice(0, 8)})`);
          if (chunkCount % 50 === 0) console.log(`[ASR] sendLoop: 已发 ${chunkCount} 帧, ${totalBytesSent} 字节 (task=${taskId.slice(0, 8)})`);
        }
      } finally {
        signal.removeEventListener('abort', onAbortSend);
      }

      // 5. 发送 finish-task（即使 abort 也发，让 DashScope 端任务正常收尾）
      console.log(`[ASR] sendLoop: 发送 finish-task (task=${taskId.slice(0, 8)}, 共 ${chunkCount} 帧 ${totalBytesSent} 字节)`);
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify({
            header: {
              action: 'finish-task',
              task_id: taskId,
              streaming: 'duplex',
            },
            payload: {
              input: {},
            },
          }));
        } catch { /* ws 已关闭 */ }
      }
    })();

    // 6. 接收识别结果
    let processedEvents = 0;
    while (!taskFinished && !taskFailed && !signal.aborted) {
      if (processedEvents >= events.length) {
        await new Promise<void>(resolve => { resolveWait = resolve; });
        continue;
      }

      const msg = events[processedEvents++];
      const event = msg.header?.event;
      console.log(`[ASR] <<< 事件: ${event} (task=${taskId.slice(0, 8)}, #${processedEvents})`);

      if (event === 'result-generated') {
        const sentence = msg.payload?.output?.sentence;
        if (sentence?.text) {
          const isEnd = sentence.sentence_end === true;
          // 跳过心跳包
          if (sentence.heartbeat !== true) {
            yield { text: sentence.text, isFinal: isEnd };
          }
        }
      }
    }

    signal.removeEventListener('abort', onAbort);

    if (taskFailed) {
      throw new Error(errorMsg || 'ASR task failed');
    }

    await sendLoop.catch(() => {});
    ws.close();
    console.log(`[ASR] Task finished: ${taskId}`);
  }
}
