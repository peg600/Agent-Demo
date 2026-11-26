# 前后端基础开发环境

基础库由TASK-003 r1准备。TASK-006添加拍卖目录，TASK-007增加会话历史，TASK-008实现知识问答、只读Agent工作流、运行/SSE与引用。使用方法见 [拍卖目录](auction-catalog.md)、[会话模块](conversations.md)、[知识问答与工作流](knowledge-workflow.md)；真实外部联调、表单与完整观测仍待完成。

## Workspace

| 包 | 作用 |
| --- | --- |
| `@gard/web` | Vue、Vite、Vue Router、Pinia 和浏览器入口 |
| `@gard/api` | Fastify、后端开发入口及数据库/模型/观测 SDK |
| `@gard/contracts` | 前后端共用的 Zod schema 和 TypeScript 类型 |

Node 使用 24.18.0 或更高的 24.x；pnpm 固定为 10.34.9。pnpm 12 的二进制引导下载在当前网络环境不稳定，因此使用可正常下载的 10.x 稳定版本，不依赖全局默认版本。

TypeScript 固定 6.0.3，以满足当前 typescript-eslint 的 `<6.1.0` peer 范围。OpenTelemetry API 固定 1.9.0，以匹配当前 SDK 2.x 的 `<1.10.0` peer 范围。准确版本以各 package.json 和 pnpm-lock.yaml 为准，不单独升级这些有 peer 约束的库。

## 常用命令

在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

如果终端没有 pnpm shim，可以用 `corepack pnpm` 替代 `pnpm`，无需修改全局 pnpm 版本。前端为 `http://127.0.0.1:5173`，API 为 `http://127.0.0.1:3001/health/live`。页面会通过 Vite 代理检查 API 连通性。

`pnpm dev` 先构建共享契约，再同时启动契约监听、API 热更新和 Vite。端口已启用严格检查，发生占用时不会悄悄切换到另一个端口。

```powershell
pnpm deps:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm test:e2e
```

`pnpm check` 顺序运行依赖导入、lint、类型检查、单元测试和生产构建。`deps:check` 仅加载 SDK，不连接数据库、RAGFlow、Langfuse 或 OpenAI。

Playwright 使用 Chromium，在独立的 3101/5174 端口启动测试服务，不复用平时的开发服务。新机器首次运行浏览器测试前执行 `pnpm exec playwright install chromium`。这些测试只验证基础环境和断线重试，不代表客服业务已经验收。

生产构建输出在各包的 dist 下；API 可以用 `pnpm --filter @gard/api start` 启动。Web 的 `preview` 仅用于检查静态构建，不提供开发代理；完整生产前后端代理将在容器部署阶段配置。

## 环境变量和数据

API 从仓库根 `.env` 读取配置，与执行命令时的工作目录无关。现有进程环境优先，测试端口不会被 `.env` 覆盖。基础 API 即使没有 OpenAI Key 或数据库连接也可启动，只代表进程存活，不代表下游依赖就绪；尚未实现 `/health/ready`。

API 监听限制为loopback；当前只有本地匿名cookie归属校验，没有正式账号认证。Vite仅读取API_HOST/API_PORT/WEB_PORT配置代理，不向浏览器注入服务端API Key。写入要求WEB_ORIGIN与浏览器源一致，SESSION_SECRET至少32字符。API正常启动会启用后台运行扫描；仅领取到任务才执行模型和知识检索，buildApp测试默认禁用执行器。

Drizzle已定义目录、访客/会话/消息、工作流运行/事件表并生成迁移。`pnpm db:generate`生成后续迁移，`pnpm db:migrate`应用业务迁移，`pnpm db:seed`导入演示目录，`pnpm db:checkpoints`初始化PostgresSaver的workflow schema；后三条会写数据库，均尚未执行。健康页为 `/setup`，目录与 `/chat` 需要数据库，智能回复另需模型/知识库配置。

## 安装行为

项目使用 npm 官方 registry，设置只作用于当前仓库。pnpm store 放在被忽略的 `.local/pnpm-store`。严格校验 peer dependencies，只允许 esbuild 的依赖安装脚本；不启用任意依赖脚本执行。

如果新机器下载超时，先确认网络代理。当前电脑安装时使用了系统已有的 loopback 代理，且只设置在安装进程中；没有将代理地址或任何凭据固化到项目或全局配置。

RAGFlow、PostgreSQL、Langfuse 服务本身仍由 Docker 配置管理，不是前端 npm 依赖；安装其客户端库不等于启动服务。Docker 部分继续参考 [本地启动手册](local-development.md)。
