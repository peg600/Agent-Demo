# Docker 与 MCP 验证结果

TASK-004 第 1 修订版，状态：待验收。日期：2026-11-26。

## 已验证

- Docker Desktop 4.100.1、Engine 29.9.3、Compose v5.7.1、MCP Toolkit v0.44.3。desktop-linux 引擎可达；沙箱直接访问 named pipe 被拒，获准的宿主机命令访问成功。
- docker ps 与 image ls 成功。已有 postgres:latest、infiniflow/ragflow:latest 镜像；它们不等于项目固定版本已经准备好。
- 实际执行 docker run --rm --network none --read-only --entrypoint /bin/echo postgres:latest agent-demo-docker-smoke-ok，返回预期文本。无端口、宿主挂载或持久卷，未启动数据库；完成后 docker ps -a 为空。
- docker mcp tools ls 成功发现 8 个 Gateway 管理工具；docker mcp tools call mcp-find query=docker 成功返回目录结果。该调用由 CLI 作为 MCP 客户端发出，不冒充当前会话原生工具调用。
- 当前插件搜索返回 Render/Railway 等云服务，没有找到适合本机容器管理的集成，未安装无关插件。Docker 目录搜索返回 docker-docs、dockerhub 等；未据此声称存在已接入的本机容器管理 MCP。

## 实际配置修改

- 创建独立空 profile：docker mcp profile create --name 'Agent Demo' --id agent-demo。
- 执行 docker mcp client connect codex --global --profile agent-demo。最初未提供 profile 的连接尝试失败，补齐配置档后成功。
- 验证 Codex 客户端状态 dockerMCPCatalogConnected=true、profile=agent-demo、error=null。
- 注册 MCP_DOCKER，命令 docker.exe mcp gateway run --profile agent-demo。此为当前用户 Codex 客户端配置，非项目业务配置。
- 带 --gateway-arg=--profile=agent-demo 再次调用 mcp-find 成功。没有添加第三方服务器，profile 中服务器数量为 0，但 Gateway 自带管理工具可用。
- 归档 TASK-003 r1，更新当前 task.md/result.md；未更改业务架构、代码或提交 Git。

## 边界及后续

Docker MCP Toolkit 用于运行和连接 MCP 服务，不自动提供本机容器管理工具。当前可以通过 CLI 使用 Docker；已测试的 MCP 能力为 Gateway 工具发现和目录搜索，未测试通过 MCP 创建或管理业务容器。

客户端提示可能需要重启 Codex。当前会话工具清单尚无 MCP_DOCKER，因此不能声称本会话已原生加载；重启或重载后仍需验证。PostgreSQL、RAGFlow、Langfuse 尚未启动，本轮结果不代表这些服务就绪。已有镜像使用 latest，后续部署仍应遵循项目固定版本。

检查全局客户端状态时，工具输出意外包含其他既有集成的认证字段；未将值写入项目文档或使用该凭据，后续输出已改为仅提取 Codex 状态。建议更换该 Neon 凭据。

官方参考：[MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/)、[CLI 客户端接入](https://docs.docker.com/reference/cli/docker/mcp/client/)。
