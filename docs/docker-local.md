# PostgreSQL 与 RAGFlow 本地 Docker 配置

根目录 `compose.yaml` 是统一入口，在 `G:\Agent-Demo` 的 PowerShell 7 中执行命令。Compose 声明端口、依赖、密码和挂载，CLI 负责按声明创建容器；创建后可以在 Docker Desktop 查看日志、停止和启动整个 `gard-local` 项目。

当前已准备文件和空目录，尚未启动业务容器。运行时数据不提交 Git。

## 文件与数据位置

| 文件或目录 | 用途 |
| --- | --- |
| `compose.yaml` | 统一组合两个服务栈 |
| `infra/compose.postgres.yaml` | 业务 PostgreSQL 19.0 |
| `infra/ragflow/compose.yaml` | RAGFlow v1.0.0 和五个依赖 |
| `.env` | 业务数据库密码与应用配置，已忽略 |
| `infra/ragflow/.env` | RAGFlow 内部服务密码，已忽略 |
| `infra/ragflow/vendor/` | 固定 v1.0.0 官方模板、启动脚本和 SQL，已忽略，可由脚本重新下载 |
| `data/` | 本机实际持久数据，整个目录已忽略 |

```text
G:\Agent-Demo\data\
├── postgres\                 业务数据库，内部为 19/docker
└── ragflow\
    ├── elasticsearch\        检索索引
    ├── mysql\                RAGFlow 元数据
    ├── minio\                上传的文档及对象文件
    ├── kvrocks\              缓存和运行状态
    ├── nats\                 持久消息队列
    ├── logs\                 RAGFlow 应用日志
    └── cache\                /root/.cache，包括配置的 Hugging Face 缓存
```

这里使用 bind mounts，不使用匿名卷存储这些数据。PostgreSQL 19 挂载目标是 `/var/lib/postgresql`，不能照搬旧版17的 `/var/lib/postgresql/data`。MySQL 首次初始化使用 `lower_case_table_names=1` 适配 NTFS；以后有数据时不能随意修改该值。

镜像层、容器可写层和 Docker 控制台日志仍由 Docker Desktop 数据磁盘管理，绑定项目目录不会把 Docker 的全部内容迁到 G 盘。Compose 已限制控制台日志大小。不要直接编辑数据库原始文件；备份业务 PG 使用 pg_dump，整套 RAGFlow 数据应在停止服务后统一备份。

## 端口

| 服务 | Windows 访问地址 | 容器端口 |
| --- | --- | --- |
| 业务 PostgreSQL | `127.0.0.1:5433` | 5432 |
| RAGFlow 网页和 API | `http://127.0.0.1:8080` | 80 |
| Elasticsearch | 仅内部 `es01:9200` | 9200 |
| MySQL | 仅内部 `mysql:3306` | 3306 |
| 对象存储 | 仅内部 `minio:9000`，控制台 `minio:9001` | 9000/9001 |
| Kvrocks | 仅内部 `kvrocks:6379` | 6379 |
| NATS | 仅内部 `nats:4222`，监控 `nats:8222` | 4222/8222 |

业务数据库名称 `gard_agent`，用户 `gard_dev`，密码取根 `.env` 的 `POSTGRES_PASSWORD`。RAGFlow 默认管理账号见上游说明，初始密码取 `infra/ragflow/.env` 的 `ADMIN_DEFAULT_PASSWORD`；不要把文件内容贴到聊天或提交 Git。RAGFlow 的 MySQL 和业务 PostgreSQL 各司其职，不能省去 MySQL。

## 当前电脑直接使用

当前目录、两个环境文件和 vendor 都已经准备完成，不需要再次初始化。

```powershell
Set-Location -LiteralPath 'G:\Agent-Demo'
docker compose config --quiet
docker compose up -d --wait --wait-timeout 600
docker compose ps
```

只先启动业务数据库：

```powershell
docker compose up -d --wait postgres
docker compose exec postgres psql -U gard_dev -d gard_agent -c 'select version();'
```

只启动 RAGFlow 及其依赖：

```powershell
docker compose up -d --wait --wait-timeout 600 ragflow-cpu
Invoke-RestMethod http://127.0.0.1:8080/api/v1/system/healthz
```

PG/RAGFlow 已按本机镜像摘要固定，复用现有镜像；另五个镜像首次启动会自动下载：`elasticsearch:8.11.3`、`mysql:8.0.40`、`pgsty/silo:RELEASE.2026-08-06T00-00-00Z`、`apache/kvrocks:2.16.0`、`nats:2.14.2`。它们使用上游版本 tag，尚未拉取并记录 digest。只下载、不启动可以执行 `docker compose pull`。

## 全新克隆时准备

以下初始化命令仅在对应文件不存在时运行；脚本会拒绝覆盖已有密钥或上游文件：

```powershell
pwsh -File scripts/prepare-data.ps1
pwsh -File scripts/prepare-upstream.ps1 -Service ragflow
pwsh -File scripts/init-local-env.ps1 -Service app
pwsh -File scripts/init-local-env.ps1 -Service ragflow
docker compose config --quiet
```

数据路径相对 Compose 文件解析，移动整个仓库后会跟随新位置；如果仍希望数据在 G 盘，应保持项目位于 G 盘。文件挂载设置 `create_host_path: false`，缺文件会报错，避免 Docker 把缺少的脚本误建成目录。

## 日常管理与边界

```powershell
docker compose logs --tail 100 ragflow-cpu
docker compose logs --tail 100 mysql es01
docker compose stop
docker compose start
# 删除容器和网络，保留项目 data/ 数据：
docker compose down
```

统一使用根 Compose 管理，不要交替用子文件创建不同项目。变更 Compose 或环境文件后用 `docker compose up -d` 应用，`restart` 不会更新容器配置。已有数据库修改 `.env` 密码也不会自动修改库内账号密码。

Docker VM 的 `vm.max_map_count` 已读取为262144，满足当前 ES 基线；重启 Desktop 后可重新检查。G 盘目前约18.4GiB可用，是否够用取决于导入、索引、日志和缓存增长。ES 保留5/3/2GB磁盘水位，空间不足时限制写入；不要通过关闭水位保护解决磁盘不足。

未启用本地 TEI、大语言模型或 GPU 服务。Chat/Embedding 使用外部 API 后续配置；文档解析仍可能需要自身 OCR/布局资源，不能保证所有解析场景都不下载模型。当前验证仅包含 Compose 解析、路径与 Git 忽略、PG临时初始化和 ES 用户写入测试；完整启动与数据持久化重启验收仍待执行。

依据：[固定 RAGFlow Compose](https://github.com/infiniflow/ragflow/blob/v1.0.0/docker/docker-compose-base.yml)、[PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)、[MySQL 大小写设置](https://dev.mysql.com/doc/refman/8.0/en/server-system-variables.html#sysvar_lower_case_table_names)。
