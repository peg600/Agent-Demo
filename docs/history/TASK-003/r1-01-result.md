# 前后端基础依赖与开发配置结果

TASK-003 第 1 修订版，状态为待验收。日期：2026-11-26。

## 实际修改

- 建立根 package.json、pnpm-workspace.yaml、pnpm-lock.yaml 和仓库级 .npmrc。固定 Node 24.x、pnpm 10.34.9 与各依赖版本，启用严格 peer 校验；实际完成安装，不只是写入依赖清单。
- apps/web 配置 Vue 3、Vite、Vue Router 和 Pinia，增加开发状态页、健康检查及失败重试。开发代理连接 Fastify，并正确处理 IPv6 loopback 地址。
- apps/api 配置 Fastify 5、TypeScript、tsx 热更新和根 .env 加载，提供 GET /health/live；默认仅监听本机，日志对认证头和 Cookie 脱敏。
- packages/contracts 提供共用的 Zod 健康响应 schema 与类型；安装 LangGraph、LangChain/OpenAI、PostgresSaver、pg、Drizzle、Langfuse/OpenTelemetry 及 Fastify Cookie/限流插件，等待后续业务接入。
- 配置 ESLint、Prettier、Vitest、Playwright 和 TypeScript；新增 scripts/check-dependencies.mjs，验证 SDK 可以加载而不连接外部服务。
- Drizzle 仅配置 schema 路径和迁移输出目录，没有业务表或迁移。本地已有 .env 保留，.env.example 补充 WEB_PORT 和 LOG_LEVEL。
- 新增 development-toolchain.md，更新 README、architecture.md（版本 4）、decisions.md（DEC-005）、implementation-plan.md、local-development.md 和 task.md。
- TASK-002 r1 原任务和结果已归档到 history/TASK-002/r1-01-*。本轮未提交或推送 Git，未宣称已同步到 Work。

## 验证证据

| 检查 | 实际结果 |
| --- | --- |
| corepack pnpm install | 通过，完成依赖安装及严格 peer 检查；仅允许 esbuild 安装脚本 |
| corepack pnpm install --frozen-lockfile --offline --ignore-scripts | 通过，锁文件一致且本地依赖已齐备 |
| corepack pnpm deps:check | 通过，19 项 SDK 导入成功，无外部服务请求 |
| corepack pnpm lint | 通过，无错误或警告 |
| corepack pnpm typecheck | 通过，三个 workspace 类型检查完成 |
| corepack pnpm test | 通过，2 个文件共 7 项单元测试 |
| corepack pnpm build | 通过，共享契约、API 和 Web 生产构建成功 |
| corepack pnpm format:check | 通过 |
| corepack pnpm test:e2e | 独立测试代理验证通过，Chromium 2 项测试：正常代理链路、连接失败提示及重试恢复 |
| corepack pnpm dev | 独立测试代理验证通过，前端 5173、API 3001 正常启动 |
| 页面与健康请求 | 页面 HTTP 200；直连 API 和通过 Vite 代理的 /health/live 均返回 status=ok、service=gard-api |
| pnpm audit --prod --json | 通过，254 项生产依赖扫描中已知漏洞计数为 0；这是本次扫描结果，不保证未来不存在漏洞 |
| git diff --check | 通过 |

独立只读审查核对 manifest 与锁文件、关键 peer 范围、依赖来源及安装脚本策略。发现的 IPv6 代理地址拼接问题已修复并复查，无剩余可操作问题。开发和浏览器测试进程已退出，3001、5173、3101、5174 无遗留监听。

## 版本选择与环境处理

精确版本以各 package.json 和 pnpm-lock.yaml 为准。主要版本为 Vue 3.5.46、Vite 8.4.0、Fastify 5.12.8、TypeScript 6.0.3、LangGraph 1.7.5、OpenAI SDK 7.65.0、Drizzle ORM 0.45.4、Langfuse SDK 6.1.1。

TypeScript 版本满足 typescript-eslint 的 <6.1.0 peer 约束，OpenTelemetry API 1.9.0 满足 SDK 2.x 的 <1.10.0 约束。pnpm 12 的二进制引导下载不稳定，因此固定可用的 pnpm 10.34.9；不修改全局默认版本。

初次 npm 下载遇到网络重置和超时，使用本机已有的系统 loopback 代理后安装成功。代理只作用于安装进程，未写入项目或全局配置。官方 registry 固定在仓库配置中；pnpm 缓存、测试产物及本地凭据均不进入版本控制。Chromium 已安装到当前用户 Playwright 缓存。

## 未实现与未验证

- 本轮完成工程基础，客服问答、会话归属、SSE、拍场工具、表单、工作流恢复和幂等尚未实现。
- 外部服务 SDK 已安装，但未连接 OpenAI、PostgreSQL、RAGFlow 或 Langfuse；健康检查仅说明 API 进程存活，不代表下游就绪。
- 未启动 Docker、准备第三方 vendor、拉取镜像或执行数据库迁移；TASK-002 的容器运行与资源占用验证仍待完成。
- API Key、模型名和实际服务联调仍待配置；没有调用付费 API。Web 生产反向代理和自有应用容器化仍按后续阶段实现。

## 启动方式

在仓库根目录运行 `corepack pnpm dev`，访问 http://127.0.0.1:5173。基础页面和 Fastify 可独立于 Docker 启动。完整命令与配置边界见 [前后端开发环境](development-toolchain.md)；Docker 依赖继续按 [本地启动手册](local-development.md) 准备。
