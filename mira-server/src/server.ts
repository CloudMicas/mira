import Fastify from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, createReadStream } from 'fs';
import { randomUUID } from 'crypto';
import { config } from './config.js';
import { Pipeline } from './pipeline.js';
import { createASRProvider, createLLMProvider, createTTSProvider, createImageProvider } from './providers/index.js';
import type { ClientMessage } from './protocol.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

// 扩展名 → MIME 映射（避免浏览器因 octet-stream 拒执 JS/CSS）
const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.wasm': 'application/wasm',
  '.map':  'application/json; charset=utf-8',
};

function mimeFor(filePath: string): string {
  return MIME_MAP[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// 静态文件服务（简单实现，不依赖插件）
app.get('/', async (req, reply) => {
  const indexPath = join(__dirname, '../../mira-web/dist/index.html');
  if (existsSync(indexPath)) {
    return reply.type('text/html; charset=utf-8').send(createReadStream(indexPath));
  }
  reply.code(404).send('Not found');
});

app.get('/*', async (req: any, reply) => {
  const url = req.params['*'];
  // /ws 是 WebSocket 路径，不归静态文件处理（虽然 upgrade 不会走 GET，这里防御性排除）
  if (url === 'ws' || url.startsWith('ws/')) {
    reply.code(404).send('Not found');
    return;
  }
  const filePath = join(__dirname, '../../mira-web/dist', url);
  if (existsSync(filePath)) {
    return reply.type(mimeFor(filePath)).send(createReadStream(filePath));
  }
  reply.code(404).send('Not found');
});

// WebSocket server
const wss = new WebSocketServer({ noServer: true });

// Pipeline 实例
const pipeline = new Pipeline(
  createASRProvider(),
  createLLMProvider(),
  createTTSProvider(),
  createImageProvider(),
);

console.log(`[Mira] Mode: ${config.mock ? 'MOCK (zero-key)' : 'REAL'}`);

// 音频缓冲队列
interface AudioQueue {
  chunks: Buffer[];
  waiters: (() => void)[];
  done: boolean;
}

const audioQueues = new Map<WebSocket, AudioQueue>();

function createAudioQueue(): AudioQueue {
  return { chunks: [], waiters: [], done: false };
}

function createAudioStream(ws: WebSocket): AsyncIterable<Buffer> {
  const queue = audioQueues.get(ws)!;
  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.chunks.length > 0) {
          yield queue.chunks.shift()!;
        } else if (queue.done) {
          break;
        } else {
          await new Promise<void>(resolve => {
            queue.waiters.push(() => resolve());
          });
        }
      }
    },
  };
}

// 在 HTTP server 上处理 WS upgrade
// 兼容根路径部署（/ws）与子路径部署（/mira/ws，前端 base 前缀）
const WS_PATHS = new Set(['/ws', '/mira/ws']);
app.server.on('upgrade', (request, socket, head) => {
  if (WS_PATHS.has(request.url || '')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

wss.on('connection', (ws: WebSocket) => {
  const sessionId = randomUUID();
  pipeline.initSession(ws, sessionId);
  audioQueues.set(ws, createAudioQueue());

  // 发送 hello
  ws.send(JSON.stringify({ type: 'hello', sessionId }));
  console.log(`[WS] Connected: ${sessionId}`);

  let audioChunkCount = 0;
  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      // 二进制 = 音频
      const queue = audioQueues.get(ws);
      if (queue) {
        queue.chunks.push(Buffer.from(data));
        audioChunkCount++;
        if (audioChunkCount === 1) console.log(`[Server] 首个音频帧到达: ${data.length} 字节 (session=${sessionId.slice(0, 8)})`);
        if (audioChunkCount % 50 === 0) console.log(`[Server] 已收 ${audioChunkCount} 帧音频 (session=${sessionId.slice(0, 8)})`);
        const w = queue.waiters.shift();
        if (w) w();
      }
      return;
    }

    try {
      const msg: ClientMessage = JSON.parse(data.toString());
      handleClientMessage(ws, msg);
    } catch {
      console.error('[WS] Failed to parse message');
    }
  });

  ws.on('close', () => {
    const queue = audioQueues.get(ws);
    if (queue) {
      queue.done = true;
      queue.waiters.forEach(w => w());
      audioQueues.delete(ws);
    }
    pipeline.removeSession(ws);
    console.log(`[WS] Disconnected: ${sessionId}`);
  });
});

async function handleClientMessage(ws: WebSocket, msg: ClientMessage) {
  switch (msg.type) {
    case 'hello':
      break;

    case 'audio_start': {
      // 全双工：audio_start 立即启动 ASR 流，边录边识别
      // 1. 让旧 queue 收尾（让正在跑的旧 ASR 流自然退出）
      const oldQueue = audioQueues.get(ws);
      if (oldQueue) {
        oldQueue.done = true;
        oldQueue.waiters.forEach(w => w());
      }
      // 2. 创建新 queue 供本次说话使用
      const newQueue = createAudioQueue();
      audioQueues.set(ws, newQueue);
      // 3. 立即启动 ASR（不 await，后台运行；二进制帧到达后 push 进 newQueue）
      //    pipeline 内部会 abort 旧 turn（barge-in：用户开口即打断 Mira）
      const audioStream = createAudioStream(ws);
      pipeline.handleAudioInput(ws, audioStream, msg.turnId);
      break;
    }

    case 'audio_end': {
      // 全双工：audio_end 只标记流结束，ASR 收尾后 pipeline 自动进 LLM
      const queue = audioQueues.get(ws);
      if (queue) {
        queue.done = true;
        queue.waiters.forEach(w => w());
      }
      break;
    }

    case 'text_input': {
      pipeline.handleTextInput(ws, msg.text, msg.turnId);
      break;
    }

    case 'interrupt': {
      pipeline.interrupt(ws, msg.turnId);
      break;
    }
  }
}

const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[Mira] Server running on http://localhost:${config.port}`);
    console.log(`[Mira] WebSocket: 接受 /ws 与 /mira/ws 两种升级路径`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
