# 本地方案官方资料

核查日期：2026-11-26。固定版本链接用于本次基线；latest 文档只用于解释机制，升级前重新核对。

| 主题 | 官方来源 | 本方案采用的信息 |
| --- | --- | --- |
| RAGFlow release | [v1.0.0](https://github.com/infiniflow/ragflow/releases/tag/v1.0.0) | 固定服务版本 |
| RAGFlow 资源 | [版本 quickstart](https://raw.githubusercontent.com/infiniflow/ragflow/v1.0.0/docs/quickstart.mdx) | CPU 起步资源和 Docker 要求 |
| RAGFlow Compose | [主配置](https://raw.githubusercontent.com/infiniflow/ragflow/v1.0.0/docker/docker-compose.yml)、[依赖](https://raw.githubusercontent.com/infiniflow/ragflow/v1.0.0/docker/docker-compose-base.yml)、[环境](https://raw.githubusercontent.com/infiniflow/ragflow/v1.0.0/docker/.env) | 默认依赖、路径、profiles 和镜像 |
| RAGFlow 检索 | [v1.0.0 API](https://ragflow.io/docs/v1.0.0/http_api_reference#retrieve-chunks) | retrieval 请求、返回片段和来源字段 |
| 重排边界 | [RAGFlow 发布记录](https://github.com/infiniflow/ragflow/blob/main/docs/release_notes.md)、[TEI rerank](https://huggingface.co/docs/text-embeddings-inference/quick_tour#re-rankers) | 内置 reranker 已移除；外部 provider 需另做版本兼容测试 |
| LangGraph 恢复 | [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) | interrupt、Command、重入和幂等 |
| LangGraph 存储 | [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[PostgresSaver](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint-postgres/README.md) | thread、setup 和独立 schema |
| Fastify | [LTS](https://fastify.dev/docs/latest/Reference/LTS/) | 5.x 与 Node 运行时兼容核对 |
| PostgreSQL | [版本支持](https://www.postgresql.org/support/versioning/) | 17 系列当前补丁与支持周期 |
| Langfuse 服务 | [v4.86.0](https://github.com/langfuse/langfuse/releases/tag/v4.86.0)、[版本 Compose](https://raw.githubusercontent.com/langfuse/langfuse/v4.86.0/docker-compose.yml) | 固定主服务版本和依赖 |
| Langfuse 本地 | [Docker Compose](https://langfuse.com/self-hosting/deployment/docker-compose) | 本地服务结构、资源与初始化 |
| Langfuse SDK | [LangChain/LangGraph](https://langfuse.com/integrations/frameworks/langchain) | JS callback 接入与依赖兼容性 |
| Docker Windows | [WSL2](https://docs.docker.com/desktop/features/wsl/) | Linux engine 与数据磁盘 |
| Compose 覆盖 | [merge](https://docs.docker.com/reference/compose-file/merge/)、[include](https://docs.docker.com/compose/how-tos/multiple-compose-files/include/) | override/reset 和最终配置校验 |
| OpenAI API | [Quickstart](https://developers.openai.com/api/docs/quickstart) | 后端 API Key 与首次调用 |
| Pro API 福利 | [帮助中心](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions)、[开发者指南](https://developers.openai.com/api/docs/guides/chatgpt-api-credits) | 领取、组织绑定及与 Codex 用量的区别 |

RAGFlow v1.0.0 的 chunks 示例字段包括 content、id、document_id、document_keyword、dataset_id、positions、similarity；不要默认使用 document_name 或假定有 URL。启用 rerank 时使用实际配置的 rerank_id，并核查候选数与分页约束。最终适配器应保存脱敏响应样例做契约测试。
