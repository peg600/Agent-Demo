# Agent-Demo
An AI Customer Support Agent Demo

嘉德智能客服 Agent 的 Windows 本地演示项目，目标包括参拍须知问答、拍场查询推荐、对话表单、多问题拆解及中断恢复。业务使用虚构资料，不连接真实拍卖生产系统。

技术基线为 TypeScript、Node.js、Fastify、LangGraph、RAGFlow、PostgreSQL、Langfuse、Docker，模型使用 OpenAI API。当前已有开发方案、基础设施配置，以及 Vue/Vite 和 Fastify 最小开发入口；客服业务代码尚未实现。

## 开发入口

- [前后端开发环境](docs/development-toolchain.md)：依赖、启动、构建、检查和测试命令。
- [架构与接口](docs/architecture.md)：服务分工、工作流、数据一致性和恢复方案。
- [本地启动手册](docs/local-development.md)：Docker、端口、密钥、RAGFlow 和 Langfuse 准备步骤。
- [Docker 配置与 G 盘数据](docs/docker-local.md)：统一 Compose 入口、端口、绑定目录和启动命令。
- [分阶段实施与验收](docs/implementation-plan.md)：从环境到完整演示的任务和验证标准。
- [官方资料](docs/sources.md)：固定版本及关键机制依据。

数据库和 RAGFlow 在 Docker Desktop，前后端先在宿主机热更新；PostgreSQL/RAGFlow 数据绑定到本项目 `data/`，整个数据目录不提交 Git。根 `compose.yaml` 管理启动配置；当前尚未启动业务容器。

基础前后端可以独立于 Docker 启动：在项目根目录执行 `pnpm dev`，访问 `http://127.0.0.1:5173`；运行 `pnpm check` 检查基础工程。实际依赖安装与验证结果见 [实施结果](docs/result.md)。

## 项目目录

| 路径 | 用途 |
| --- | --- |
| `apps/web/` | 客服对话页面 |
| `apps/api/` | 服务端接口、工作流和业务工具 |
| `apps/api/src/db/` | 业务表定义和数据库访问代码 |
| `apps/api/drizzle/` | 预留的数据库迁移目录 |
| `knowledge/` | 可公开的演示须知和知识库素材 |
| `infra/` | 本地依赖服务的配置 |
| `docs/` | 架构、决策、当前任务和实施结果 |

## 本地开发

演示计划使用虚构场次或脱敏数据。可复用的配置、表结构、迁移和示例资料随代码管理。开发机上的密钥放在本地环境变量或 `.env` 文件，容器数据和数据库备份保存在版本控制之外。

项目决策见 [决策记录](docs/decisions.md)，实现进度见 [当前任务](docs/task.md) 和 [实施结果](docs/result.md)。
