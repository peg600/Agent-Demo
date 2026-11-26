# 嘉德客服本地方案交付结果

TASK-002 第 1 修订版，状态为待验收。日期：2026-11-26。

## 实际修改

- 更新 architecture.md 为版本 3，补齐技术栈、部署边界、模块、API/SSE、数据表、工作流、恢复、确认及幂等方案。
- 在 decisions.md 追加用户指定技术栈和 OpenAI API 配置决策；新增 local-development.md、implementation-plan.md、sources.md，并更新 README 入口。
- 新增业务 PostgreSQL Compose、RAGFlow/Langfuse 本地覆盖配置、固定上游版本清单、环境模板、下载准备与密钥初始化脚本。
- 生成本机根 .env 和 infra/langfuse/.env 的随机本地凭据，保留外部 API Key 和模型名为空；这些文件均被 Git 忽略，不打印秘密。
- 原 TASK-001 r2 任务和结果已归档到 history/TASK-001/r2-02-*；没有将原迁移任务擅自标为已验收。
- 本轮未实现业务接口和前端，没有启动容器、安装 npm 依赖、调用模型或更改账户账单，没有提交和推送本轮文件。

## 验证证据

- PowerShell Parser 检查两个 scripts/*.ps1：通过。
- 实际执行 init-local-env.ps1 的 app 和 langfuse 分支：通过；核对密码与数据库 URL、对象服务密钥一致，未输出密钥值。
- 再次执行初始化：正确拒绝覆盖，已有文件哈希不变。
- docker compose --env-file .env -f infra/compose.postgres.yaml config --quiet：通过。这不是数据库运行测试。
- README 与活动 docs 的相对链接检查：通过。
- git check-ignore：根和 Langfuse .env、上游缓存和 vendor 内 .env 均被忽略。
- git diff --check：通过。
- 独立只读安全审查：未发现可证实漏洞；根据建议修正架构图中的重排位置。运行隔离和幂等尚待业务实现后验证。

## 当前环境与未完成验证

- 本机约 31.8GB 内存、i5-13600KF，G 盘约 18.9GB 剩余。方案要求 Docker 数据盘放空间充足的 C/E 盘并使用 named volumes，未修改系统设置。
- Docker CLI 和 Compose 存在，但 Linux engine pipe 尚不可达；用户正在安装配置，未自动干预。
- 从命令行下载 RAGFlow 上游时遇到 github.com DNS 解析失败，pnpm 首次解析也遇到 registry.npmjs.org DNS 失败。官网资料经网页研究核查，但没有因此声称上游下载已经完成。
- RAGFlow/Langfuse vendor 尚未准备，合并配置、镜像拉取、健康检查与资源占用未运行验证。prepare-upstream.ps1 的联网下载分支尚未端到端通过。
- API Key 和模型名待用户填写，真实模型、embedding、检索、重排、业务运行和浏览器验收均未执行。

## 与用户描述的差异

- 采用本地虚构拍场和咨询预约演示，不宣称接入嘉德生产服务或完成项目履历。
- 第一版 RAGFlow 负责召回，Fastify 使用 OpenAI 结构化输出在应用层重排，避免将尚未验证的原生 rerank provider 写成可用功能。原生 RAGFlow 重排属于后续兼容性验证项。
- 前后端先在 Windows 热更新，完整自有应用容器化安排在 M6；数据库与 RAGFlow 按用户要求使用 Docker Desktop。
- 业务方案已落盘，但完整系统能否在当前 32GB 机器上并行运行 RAGFlow 和 Langfuse，仍需按阶段实测，不能以配置检查代替性能验证。

## 下一步

Docker Desktop 完成安装后按 local-development.md 完成 M0，填入 OpenAI API 配置并验证福利所属组织的额度。后续业务实现按 M1–M6 分阶段推进。
