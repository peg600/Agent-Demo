# 前后端基础开发环境

本轮为 TASK-003 r1：安装和配置基础库，提供能单独运行的前端页面及 Fastify 存活检查。当前还没有客服、会话、表单、数据库表和模型调用功能。

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

API 监听限制为 loopback；当前没有身份认证，不能把这个骨架暴露到局域网。Vite 仅读取 API_HOST/API_PORT/WEB_PORT 配置代理，不向浏览器注入服务端 API Key。对外部服务的 SDK 当前只是已准备的依赖，后续任务才注册和调用。

Drizzle 已配置业务 schema 路径和迁移输出目录；尚无业务表或可应用的迁移。以后增加表后，使用 `pnpm --filter @gard/api db:generate` 生成迁移，审查 SQL 后再运行 `db:migrate`。本轮不执行数据库迁移。

## 安装行为

项目使用 npm 官方 registry，设置只作用于当前仓库。pnpm store 放在被忽略的 `.local/pnpm-store`。严格校验 peer dependencies，只允许 esbuild 的依赖安装脚本；不启用任意依赖脚本执行。

如果新机器下载超时，先确认网络代理。当前电脑安装时使用了系统已有的 loopback 代理，且只设置在安装进程中；没有将代理地址或任何凭据固化到项目或全局配置。

RAGFlow、PostgreSQL、Langfuse 服务本身仍由 Docker 配置管理，不是前端 npm 依赖；安装其客户端库不等于启动服务。Docker 部分继续参考 [本地启动手册](local-development.md)。
