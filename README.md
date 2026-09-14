# Mira — 雨夜咖啡馆的 AI 角色语音互动

一个可语音对话的 Live2D 虚拟角色 Demo：按住说话，Mira（一位雨夜咖啡馆里的旅行摄影师）会听你说话、回你话，同时根据对话内容切换表情、动作、镜头、场景，甚至生成她提到的照片。全链路流式（ASR → LLM → TTS），支持随时打断（barge-in）。

- 后端 `mira-server/`：Node.js + Fastify + WebSocket，编排 ASR/LLM/TTS 流水线
- 前端 `mira-web/`：React + Vite + PIXI.js Live2D，负责采集、播放与场景演出

## 一、系统结构和主要模块

```
┌────────────────────────── mira-web (React + Vite) ──────────────────────────┐
│  InteractionLayer    按住说话 / 文字输入 / 打断按钮                            │
│  audio/AudioCapture  getUserMedia → AudioWorklet → 16kHz PCM 上行            │
│  audio/AudioScheduler 音频播放调度：seq 排序、无缝衔接、turnId 过滤            │
│  ws/WSClient         WebSocket 封装（JSON 控制帧 + 二进制音频帧）             │
│  store/characterStore (zustand) 角色状态机：idle/listening/thinking/speaking │
│  components/Scene    Live2D 角色 / 背景 / 特效 / 媒体四层渲染                │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ WebSocket /ws
┌─────────────────────────────────▼───────────────────── mira-server (Fastify) ┐
│  server.ts   WS 升级、音频队列（AsyncIterable）、静态托管前端产物              │
│  pipeline.ts 核心流水线：ASR→LLM→TTS 流式编排、turnId 取消体系、TTS 限流       │
│  protocol.ts 前后端共享协议定义 + LLM 指令解析                                 │
│  providers/  可插拔服务工厂：asr / llm / tts / image（真实 + mock 双实现）     │
└──────┬──────────────┬──────────────┬──────────────┬──────────────────────────┘
       ▼              ▼              ▼              ▼
  DashScope ASR   DashScope LLM  DashScope TTS  通义万相文生图
```

**后端模块**

| 模块 | 职责 |
| --- | --- |
| `server.ts` | WS 连接管理；二进制帧入音频队列，JSON 帧走控制消息分发；托管 `mira-web/dist` 实现单源部署 |
| `pipeline.ts` | 每会话状态（turnId / history / AbortController）；ASR 流式识别 → LLM 流式生成 → 分句 → 并发受限 TTS → 下发；打断与图片生成 |
| `protocol.ts` | 上行/下行消息类型；LLM 输出中 `@{...}` 指令行的解析 |
| `config.ts` | 环境配置 + 角色卡 system prompt（人设、对话规则、输出协议） |
| `providers/` | 工厂函数按配置选择真实 / mock 实现：ASR（DashScope）、LLM（通义 / DeepSeek / mock）、TTS（DashScope / Edge TTS / mock）、文生图（万相） |

**前端模块**

| 模块 | 职责 |
| --- | --- |
| `useInteraction.ts` | 交互编排：按住说话 → 采集上行 → 处理服务端消息 → 驱动状态机 |
| `AudioCapture.ts` | AudioWorklet 降采样为 16kHz PCM 裸流（无压缩）上行 |
| `AudioScheduler.ts` | 按 `seq` 顺序播放、乱序暂存 pending、无缝衔接；打断即停即清空 |
| `characterStore.ts` | zustand 状态机 + 指令应用（emotion/pose/camera/scene/fx/media） |
| `Live2DCharacter.tsx` | PIXI 渲染：情绪 → 面部参数，姿势 → 身体朝向/视线，说话时程序化口型开合 |
| `Scene/*` | 背景层、角色层、特效层、媒体层，由指令驱动切换 |

**部署**：`docker-compose.yml` 两个服务——`mira-web`（nginx，暴露 5173，SPA 回退 + 静态资源长缓存 + `/ws` 反代到后端）与 `mira-server`（不对外暴露端口，仅走 Docker 内部网络）。

## 二、语音交互与打断流程

**正常回合**（按住说话，松开结算）：

1. 按下 → 初始化/解锁 AudioContext（移动端需用户手势）→ 分配新 `turnId` → 发 `audio_start`
2. AudioWorklet 持续产出 16kHz PCM 二进制帧上行；服务端收到 `audio_start` **立即启动流式 ASR**（paraformer-realtime-v2，边录边识别，全双工）
3. 松开 → 发 `audio_end` → ASR 出最终文本 → LLM（qwen）流式生成
4. 服务端按标点分句，每句并行做 TTS；字幕（`subtitle`）与音频（8 字节头 `turnId+seq` + PCM）依次下发
5. 前端 AudioScheduler 按 `seq` 排序无缝播放；`audio_start` 驱动口型与 speaking 状态，`turn_end` 回 idle

**打断（barge-in）**：Mira 说话时用户按下按钮即打断，三层同时生效——

1. **前端立即静音**：`AudioScheduler.interrupt()` 停掉当前 `AudioBufferSourceNode`、清空播放队列与 pending，不等一个音频帧
2. **通知服务端**：发 `interrupt{turnId}`，服务端 `AbortController.abort()` 同时掐断 LLM 流和 TTS 合成，回 `turn_cancelled`
3. **迟到帧丢弃**：所有下行消息都带 `turnId`，前端入口与 commit 前双重校验，turn 切换后旧帧直接扔掉

另外两条防御性路径：新 `audio_start` 会在服务端隐式 abort 上一 turn（用户开口即打断）；快速按下又松开的竞态用 `interrupt` 代替 `audio_end`，避免 ASR 结算空音频报错。

**设计核心是 turnId（epoch）取消体系**：每次用户输入单调递增，任何一处发现 turnId 不匹配即丢弃，无需逐帧撤销。

## 三、角色和场景指令的设计

**角色卡**（`config.ts` 的 `SYSTEM_PROMPT`）：人设（26 岁旅行摄影师、雨夜咖啡馆、在等一个三年前约定的人）+ 对话规则（什么时候才自我介绍、什么话题接什么）+ 输出协议。台词限每句 ≤20 字、每次 1-2 句，保证口语化与低延迟。

**指令协议**：要求 LLM 每段回复首行输出指令块，之后才是台词：

```
@{"emotion":"warm","pose":"hold_cup","camera":"medium"}
你也在等雨停吗？
```

| 维度 | 取值 | 前端映射 |
| --- | --- | --- |
| emotion | neutral / warm / sad / surprised / thinking | Live2D 面部参数（嘴型、笑眼、眉毛、腮红）插值 |
| pose | idle / lean_counter / hold_cup / look_window | 身体角度与视线参数 + 对应 motion |
| camera | wide / medium / close | 镜头景别切换 |
| scene | cafe_counter / cafe_window | 背景切换 |
| fx | thunder / rain_heavy / light_flicker | 特效层 |
| media | `{type:image, event, prompt, caption}` | 异步文生图，完成后展示（如展示极光照片） |

**两个关键规则**：

- **触发与内容绑定**：prompt 明确要求指令必须由对话内容触发（聊打雷才有 thunder、用户主动要照片才有 media），禁止每句乱撒表情/特效，防止演出疲劳
- **指令不进上下文**：流水线解析出指令行后，从累计回复中剔除再存入 history，避免污染下一轮 LLM；解析失败则静默跳过，不影响台词

前端情绪与姿势参数刻意**正交划分**：emotion 只碰面部表情参数，pose 只碰身体角度/眼球参数，避免两组插值打架导致模型晃动。

## 四、使用的模型、媒体方案和主要第三方服务

| 能力 | 方案 | 说明 |
| --- | --- | --- |
| ASR | 阿里云百炼 `paraformer-realtime-v2` | WebSocket 流式识别，边录边出字 |
| LLM | 阿里云百炼 `qwen-plus`（默认，env 可换 qwen-turbo 等） | OpenAI 兼容流式；`llm-deepseek.ts` 备有 DeepSeek 实现 |
| TTS | 阿里云百炼 `cosyvoice-v2`（音色 longxiaochun 龙小淳） | 兜底方案：微软 Edge TTS（`zh-CN-XiaoxiaoNeural`，零 Key 可跑） |
| 文生图 | 阿里云百炼 `wanx2.1-t2i-turbo`（通义万相） | 异步生成，不阻塞对话流 |
| 角色渲染 | PIXI.js 7 + pixi-live2d-display + Live2D Hiyori 免费模型 | 口型为程序化模拟（正弦+噪声），非真实音量驱动 |
| 音频传输 | 原生 WebSocket 二进制帧（16kHz PCM 裸流，自定义 8 字节头） | 未用 WebRTC/LiveKit |
| 开发态 | `MOCK=1` 零 Key mock providers + 前端 `mock/scenario.ts` | 无 Key 离线开发 |

所有云端能力统一走一个 DashScope API Key，`.env.example` 一处配置。

## 五、关键技术选择与取舍

- **turnId epoch + AbortController，而不是逐帧取消消息**。一次 abort 贯穿 LLM/TTS 全链，配合前后端双重 turnId 校验丢弃迟到帧。实现极简，代价是"取消粒度 = 整个回合"（当前足够）。
- **分句流式 TTS，而不是整段合成**。首句音频不等 LLM 全部生成完就开播，端到端首响显著降低。代价是 DashScope TTS 并发 429，于是加了**信号量限流（并发=2）+ 429 退避重试**。
- **WebSocket PCM，而不是 WebRTC/LiveKit**。按住说话场景带宽可接受，省掉 UDP/TURN/信令整套基础设施，部署只需 nginx 反代。取舍：延迟略高、无回声消除（依赖浏览器 AEC）。
- **TTS 失败发空二进制帧**。前端 `decodeAudioData` 失败会走 error 回调并 pump 下一句，用这个"脏 hack"保证调度器不因单句失败卡死整个队列——能跑，但不优雅（见已知问题）。
- **指令用首行 `@JSON` 文本协议，而不是 function calling**。解析零依赖、流式可处理（读到换行即可）。取舍：依赖模型遵循度，坏行只能静默丢弃。
- **Provider 工厂 + mock 双实现**。`MOCK=1` 全链路零 Key 可跑通（含前端假剧本），协作与演示不依赖付费 Key。
- **Live2D 静止优化**：关闭自动眨眼/呼吸/鼠标跟随，参数插值到位后停掉 PIXI ticker——无交互时角色完全静止、零渲染开销；说话时 ticker 重启驱动口型与表情。
- **历史只留最近 20 条、仅存内存**：控制上下文成本，放弃持久化换实现速度。

## 六、已知问题

1. **打断后的对话丢失**：回合中途被打断时该轮 user/assistant 内容不写入 history（abort 后跳过保存），上下文出现"记忆空洞"
2. **无 VAD 自动打断**：必须按按钮才能打断，不能像真人对话那样"开口即停"（服务端全双工已就绪，缺前端持续监听 + VAD 判定）
3. **`asr_partial` 未展示**：前端收到中间识别结果暂不处理，用户说话时没有实时出字反馈
4. **TTS 空帧 hack**：靠让前端解码失败来跳句，属于脆弱的隐式契约
5. **指令遵循靠 prompt 约束**：LLM 偶尔漏发/发错指令块，无 schema 校验与重试
6. **角色模型是通用 Hiyori**，并非 Mira 专属立绘；pose 只有 4 种、fx 只有 3 种，演出表现力有限

## 七、大致投入时间

约 **12 小时**（含技术选型、协议设计、前后端联调与 Docker 化）。

## 八、本地部署

### 环境要求

- Node.js ≥ 20、npm

### 运行模式

| 模式 | 配置 | 效果 |
| --- | --- | --- |
| 全 mock | `MOCK=1` | ASR/LLM 假数据、TTS 静音，完全离线零依赖，验证链路用 |
| 零 Key 兜底 | 不配 Key（`MOCK=0`） | ASR/LLM 为 mock，TTS 走 Edge TTS 真人语音，不花钱 |
| 完整链路 | 配 `DASHSCOPE_API_KEY` | ASR/LLM/TTS/文生图全真实 |

### Docker Compose

```bash
# 需要先把 DASHSCOPE_API_KEY 写进 mira-server/.env
docker compose up -d --build
# 访问 http://localhost:5173（nginx 已反代 /ws 到后端容器）
```

