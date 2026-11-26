# 嘉德客服本地开发与启动手册

本手册从项目根目录 `G:\Agent-Demo` 使用 PowerShell 7。当前已有基础工程、Docker配置、拍卖目录及会话历史前后端，完整客服功能尚未实现，真实数据库与浏览器联调待执行。前后端依赖与现有命令见 [开发环境](development-toolchain.md)，下文保留 Docker 准备和后续业务实施步骤。

## 机器与资源安排

2026-11-26 在 TASK-002 检查到：i5-13600KF，14 核/20 线程，约 31.8GB 内存；G 盘约 18.9GB 可用，C 盘约 639.8GB。Node 为 24.18.0，Docker CLI 为 29.9.3，Compose 为 5.7.1；当时 Docker Linux 引擎未连接成功。TASK-003 已安装 npm 依赖；TASK-004 已验证 Docker 引擎可用；TASK-005 已准备统一 Compose 和 G 盘绑定目录，业务容器尚未启动。

依据用户最新要求（DEC-006），代码与 PostgreSQL/RAGFlow 持久数据都保留 G 盘，数据绑定项目 data/ 并被 Git 忽略。取代原 C/E 盘 named volumes 建议；镜像层和 Docker 自身日志仍由 Desktop 数据磁盘管理。详细路径和命令以 [Docker 配置](docker-local.md) 为准。RAGFlow 官方起步建议 4 核、16GB、50GB；32GB 主机先运行业务 PG + RAGFlow，再加入观测服务。[RAGFlow 要求](https://raw.githubusercontent.com/infiniflow/ragflow/v1.0.0/docs/quickstart.mdx)

开发可从 WSL2 约 20–22GB 内存预算起步，给 Windows、浏览器和编辑器留余量，这是本项目预算建议，不是已测出的最低配置。Langfuse 官方完整本地栈另给出 16GiB 起步规格，不能保证两套服务在这台机器并行满足官方建议。先用小资料集、外部模型、单任务并发，解析导入与全栈演示错峰；通过 `docker stats` 实测。若发生 OOM，先减少导入并发，仍不足时需扩容或另行决定观测服务部署位置。关闭 Langfuse 只用于开发阶段，不算完整验收。

## 版本策略

| 组件 | 方案基线 |
| --- | --- |
| Node | 24 LTS，现有 24.18.0；首次安装核对包 engines |
| Fastify | 5.x；初始化时锁定确切版本与插件兼容性 |
| LangGraph JS | 1.x；匹配 `@langchain/core` 和 PostgreSQL checkpointer |
| RAGFlow | v1.0.0，CPU + Elasticsearch + MySQL 默认组合 |
| 业务 PostgreSQL | 19.0，用户确认使用已下载镜像并固定 digest |
| Langfuse server | v4.86.0；SDK 独立核对，不把服务端版本当 SDK 版本 |

第三方版本在 `infra/upstream-versions.json` 管理。准备脚本获取固定 release tag、记录实际 commit 和保留许可证；第三方配置生成于仓库内 `infra/*/vendor/`，不提交整份上游源码。自有 Compose、覆盖文件和脚本受 Git 管理。上游内部仍有浮动依赖镜像，第一次真实拉取并通过测试后记录所有镜像 digest；当前不是全镜像锁定构建。npm 依赖在 M1 生成 pnpm-lock.yaml，以后 frozen-lockfile 安装，不在文档伪造尚未安装的精确依赖版本。

## 先完成 Docker Desktop

启用 WSL2 和 Linux containers。安装完成后运行：

```powershell
Set-Location -LiteralPath 'G:\Agent-Demo'
wsl --version
docker version
docker compose version
docker info
```

`docker version` 必须同时出现 Client 与 Server；只有 Client 不算可用。RAGFlow 默认 Elasticsearch 要求 Linux VM 内 `vm.max_map_count >= 262144`，引擎可用后读取：

```powershell
wsl -d docker-desktop -u root sysctl vm.max_map_count
```

若不足，按 Docker/WSL 当前版本设置 Linux VM 参数；临时设置命令如下，重启引擎后需复查，不能只修改普通 Ubuntu 发行版的参数后假定 Docker 已生效：

```powershell
wsl -d docker-desktop -u root sysctl -w vm.max_map_count=262144
```

## 初始化与启动 PostgreSQL / RAGFlow

当前工作区已完成目录、根 .env、infra/ragflow/.env 和固定上游文件准备。新的统一入口是项目根 compose.yaml，不再使用旧 RAGFlow override；完整目录表、初始化和管理命令见 [Docker 配置与 G 盘数据](docker-local.md)。

```powershell
Set-Location -LiteralPath 'G:\Agent-Demo'
docker compose config --quiet
# 只启动业务数据库：
docker compose up -d --wait postgres
# 或启动全部七个服务；缺失的五个依赖镜像会自动下载：
docker compose up -d --wait --wait-timeout 600
docker compose ps
Invoke-RestMethod http://127.0.0.1:8080/api/v1/system/healthz
```

以上为后续启动命令，本轮尚未执行。Compose 配置通过不能替代服务就绪验收。全新克隆先按 Docker 配置文档运行 prepare-data、prepare-upstream 和 init-local-env；已有文件不要重复初始化。

拍卖目录的两张表及迁移已生成，但尚未执行入库；后续初始化参见 [拍卖目录模块](auction-catalog.md)。gard_dev 仅供本地开发，生产应分离迁移与运行账号。RAGFlow 的业务元数据仍由其 MySQL 管理，当前MySQL配置不能直接删除它；改用PostgreSQL需另行验证对应后端及迁移兼容性。

打开 RAGFlow，创建演示知识库及 API token；管理员初始密码由脚本写在本地 infra/ragflow/.env 的 ADMIN_DEFAULT_PASSWORD 中，勿将其贴入聊天或提交 Git。先在模型设置中配置 OpenAI Embedding 模型和 API Key，再创建及解析数据集。根 `.env` 不会自动同步到 RAGFlow 管理界面。

导入 5–10 份虚构 Markdown/TXT，例如参拍流程、预展、保证金说明、取件流程和咨询说明；为文档维护来源 ID、版本、生效日期和主题。导入完成后必须核对切片内容与检索结果，不能以“上传成功”替代“索引完成”。将 API token、dataset ID 写回根 `.env`。

固定版本检索接口的最小请求为 Bearer token + `question` + `dataset_ids`，例如：

```json
{
  "question": "演示拍场如何预约咨询？",
  "dataset_ids": ["替换为实际数据集ID"],
  "page": 1,
  "page_size": 5,
  "include_knowledge_compilation": false
}
```

后续适配器必须处理 HTTP 成功但 JSON code 非 0、无 chunks、资料过期等情况。实时档期通过业务 API，不放到固定知识文档作为事实来源。

## OpenAI 模型配置

用户计划使用 Pro 订阅的 API 福利。符合条件的 Pro 订阅目前可领取 API credits，需要在 ChatGPT Settings → Billing 或 API Platform Billing 中关联并激活到自己拥有的 API 组织，再检查到账情况。资格、额度和有效期以账号界面为准，本项目不假定已领取。[官方福利说明](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions)

本应用调用 OpenAI 模型 API，不调用 Codex CLI，也不复用 Codex 登录 token。福利不覆盖通过 API Key 使用 Codex 的用量；本客服使用的普通模型 API 与之区分。[开发者说明](https://developers.openai.com/api/docs/guides/chatgpt-api-credits)

稍后在根 `.env` 填写 `OPENAI_API_KEY`、`OPENAI_CHAT_MODEL` 和 `OPENAI_EMBEDDING_MODEL`。模型名以实际 API 组织可访问列表及 structured outputs 支持情况为准。Chat 与 embedding 使用不同类型的模型；RAGFlow 数据集生成向量后不能直接换 embedding 模型而不重建索引。

API Key 仅在后端及 RAGFlow 服务配置中使用，前端不包含任何 `VITE_OPENAI_*` 密钥。首次模型验收用一条虚构消息验证结构化输出，再验证一次 embedding；没有 Key 时可测试契约与 mock，但不能验收真实模型链路。不自动充值、不自动修改账单设置。

## 后期开启 Langfuse

业务链路完成后再启动观测栈：

```powershell
pwsh -File scripts/prepare-upstream.ps1 -Service langfuse
pwsh -File scripts/init-local-env.ps1 -Service langfuse
$lfArgs = @('--project-name','gard-langfuse','--project-directory','infra/langfuse/vendor','--env-file','infra/langfuse/.env','-f','infra/langfuse/vendor/docker-compose.yml','-f','infra/langfuse/compose.local.yaml')
docker compose @lfArgs config --quiet
docker compose @lfArgs up -d
docker compose @lfArgs ps
Invoke-RestMethod http://127.0.0.1:3000/api/public/health
```

默认不上 AI Gateway；本项目直连 OpenAI，不需要另一个代理。访问本地 Langfuse 注册管理员、创建项目，把 public/secret key 写入根 `.env`，设置 `LANGFUSE_ENABLED=true`。不要把 Langfuse 自己的数据库密码当成 SDK Key。所有内部数据库端口由 override 隐藏，两套第三方依赖不共享数据库和卷。

## 前后端与后续业务命令

当前已有 install、dev、build、typecheck、lint、test、test:e2e，以及 db:generate/db:migrate/db:seed。目录和会话迁移已生成；迁移和种子属于写库操作，本轮未执行，具体初始化见 [拍卖目录模块](auction-catalog.md) 与 [会话模块](conversations.md)。评估命令 eval:smoke及 PostgresSaver.setup 仍待后续实现。

使用 frozen-lockfile 安装依赖；Vite已代理 /api，SSE业务本身仍未实现。后续SSE代理不得缓存或缓冲事件。

宿主进程通过 `127.0.0.1:5433/8080/3000` 访问容器。将来 API 容器化时，业务 PG 用 Compose 服务名，其他独立栈通过明确配置的网络或 `host.docker.internal`，不能继续把容器中的 localhost 当宿主机。

## 排障与保存数据

| 现象 | 检查 |
| --- | --- |
| Docker pipe 不存在 | Desktop 是否启动、WSL2/Linux engine 是否就绪 |
| Git/npm 域名解析失败 | 主机 DNS/代理与镜像源网络；不靠清空项目解决 |
| RAGFlow 不就绪 | compose ps/logs、MySQL/ES 健康、vm.max_map_count、磁盘与内存 |
| 模型 401/403/429 | Key 所属组织、模型权限、速率或 credits；不无限重试 |
| 检索无结果 | embedding 配置、解析状态、dataset ID、过滤条件、资料有效期 |
| SSE 不更新 | 代理缓冲、cookie、运行状态、游标与事件落库 |
| 重启后丢数据 | 项目 data/ 是否仍在、挂载路径是否改变；Langfuse 另查其 named volumes |

PG/RAGFlow 日常使用根目录 `docker compose stop`；`docker compose down` 删除容器和网络但保留 data/。Langfuse 仍使用独立配置和 named volumes，不要把 `down -v` 当普通重启步骤。备份业务 PG 使用 pg_dump 的自定义格式和输出文件参数，恢复测试另建空数据库；RAGFlow 的原始演示知识文件和来源清单也随项目保留。备份、真实 `.env`、上游下载缓存及容器数据均不提交 Git。
