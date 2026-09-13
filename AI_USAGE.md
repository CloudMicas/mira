# AI_USAGE.md — AI 使用说明

本项目为 AI 辅助开发，以下如实记录 AI 的参与范围、人工验证方式及典型问题修正案例。
由于本人在国内, 以国内的AI工具为主。

## 1. 使用的 AI 工具

- **Trae AI IDE**（内置 AI 编程助手）：代码生成、Bug 定位与修复、重构、文档撰写，覆盖前后端全部模块
- **qwen-plus（通义千问）**：作为产品运行时依赖，非开发工具——承担角色对话 LLM（见 README 模型方案）

## 2. AI 主要参与的工作

- **前端 mira-web**：React + zustand 状态管理、Live2D 角色渲染、AudioCapture 采集、AudioScheduler 无缝播放调度（turnId 双重校验）、WSClient 自动重连
- **后端 mira-server**：Fastify + WebSocket 服务、ASR → LLM → TTS 流式流水线、分句 TTS 并发限流（429 重试）、@JSON 指令协议设计与流式解析、turnId epoch 取消体系
- **Provider 适配**：DashScope WebSocket/HTTP 协议对接（paraformer ASR、cosyvoice TTS、万相文生图）、Edge TTS 零 Key 兜底
- **部署**：Nginx HTTPS 站点配置（静态托管 + WSS 反代）、git 代理配置
- **文档**：README.md（架构图、打断机制、技术取舍、已知问题）

## 3. 经过人工验证的关键结果

- **全链路真机联调**：按住说话 → ASR 字幕 → LLM 回复 → TTS 播放 → 口型同步，浏览器实测通过
- **三层打断机制**：前端立即停止 / AbortController 中断 LLM+TTS / 迟到帧按 turnId 丢弃，实测打断后无残留播放
- **指令协议**：控制台核对 `directive` → `subtitle` → `audio_frame` → `播放` 日志顺序与内容
- **图片生成**：确认聊挪威出雪山、聊冰岛出极光（修复后按话题匹配）
- **TTS 限流**：429 重试日志真实触发，音频不缺句
- **部署**：HTTPS + WSS 域名实际访问验证

## 4. AI 生成结果问题修正案例

### 案例：字幕泄漏畸形 JSON（AI 写的解析器被 LLM 畸形输出击穿）

**问题**：早期 AI 实现的 pipeline 指令解析器采用「等换行符」策略——`@` 开头的行读到 `\n` 才解析。实测中 qwen-plus 输出了同行粘连的畸形格式：

```
@{"emotion":"warm","pose":"look_window","camera":"wide"}{"scene":"cafe_window"}{挪威的雪山，那里的星空特别美。...
```

指令与台词粘在一行，换行永远不来，分句器被跳过，**整段原文泄漏进字幕和 TTS 朗读**。

**发现**：人工在浏览器控制台看到 `[WS] <<< subtitle ... text="@{"emotion"...` 异常日志。

**修正**：
1. 重构 [pipeline.ts](mira-server/src/pipeline.ts) 解析器：平衡大括号提取（字符串感知）替代等换行，不依赖 LLM 记得换行；支持连续剥离多个 JSON 块；`cleanDialogue` 净化台词中杂散的 `@{}` 符号；history 只存纯台词，避免畸形格式污染后续上下文形成恶性循环
2. 逐字符流式喂入（最坏 token 切分）写了 6 个回归用例（含事故原始字符串），全部通过
3. 同步加固 config.ts 提示词（禁止同行粘连/多 JSON 块），并删除了「错误示范」原文——负面示例在 prompt 中有被 LLM 模仿的风险

### 案例：图片生成永远是极光

**问题**：AI 写的 prompt 中只给了冰岛极光一个 media 示例，LLM 倾向复制唯一示例，聊任何旅行地都生成极光。

**发现**：人工对话聊清迈，发现生成的仍是极光。

**修正**：扩充为 6 个旅行地示例（寺庙/雪山/圣湖/星河/沙漠），并在触发规则中绑定「prompt 必须匹配当前对话提到的旅行地」。教训已记录：LLM 会复制 prompt 中唯一的示例，需要多样化示例。
