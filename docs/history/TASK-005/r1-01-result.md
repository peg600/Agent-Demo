# G 盘 Compose 配置交付结果

TASK-005 第 1 修订版，状态：待验收。日期：2026-11-26。

## 实际修改

- 根 compose.yaml 作为统一入口，include 业务 PostgreSQL 和裁剪自固定上游的 RAGFlow CPU 配置；保留 7 个服务，无可误启用的 GPU、TEI、sandbox 等额外 profile。
- infra/compose.postgres.yaml 使用已下载并由用户确认的 PostgreSQL 19.0 摘要，绑定 data/postgres 到 /var/lib/postgresql，PGDATA=/var/lib/postgresql/19/docker，端口 127.0.0.1:5433。
- infra/ragflow/compose.yaml 取代旧 compose.local.yaml。RAGFlow v1.0.0 使用本机镜像摘要；保留 Elasticsearch 8.11.3、MySQL 8.0.40、pgsty/silo 对象服务、Kvrocks 2.16.0、NATS 2.14.2。仅发布 RAGFlow 127.0.0.1:8080，依赖只在内部网络通信。
- RAGFlow 日志、缓存、检索索引、MySQL、对象文件、Kvrocks、NATS 均绑定 data/ragflow 下独立子目录。上游配置/入口/SQL 为只读挂载；所有 bind 都禁止自动创建错误路径。
- 新增 scripts/prepare-data.ps1，已建立空目录；/data/ 加入 .gitignore。Compose 控制台日志限制每容器最多约 3×10MB；镜像和 Docker 自身日志仍在 Desktop 管理的数据磁盘，不属于项目 bind 数据。
- 新增 infra/ragflow/.env.example；init-local-env.ps1 的 ragflow 分支改用独立模板，已生成被忽略的 infra/ragflow/.env 随机密码。根已有 .env 保持不变。
- 成功准备上游 v1.0.0 Docker 文件，commit db1cd5929a7885a3074547791f5ecc4d2f891739，位于被忽略的 infra/ragflow/vendor/，保留来源及许可证。此前未通过的上游下载现在已通过。
- 更新版本清单、架构、决策、README、本地启动与实施计划；新增 docker-local.md。归档 TASK-004 r1。

## 验证证据

- 一次性无网络版本查询：PostgreSQL 19.0、RAGFlow VERSION=v1.0.0。未启动数据库进程或 RAGFlow 服务。
- docker compose config --quiet 通过，config --services 返回 es01、kvrocks、minio、mysql、nats、ragflow-cpu、postgres。
- 解析 config JSON（不输出凭据）核对 12 个 bind 源均存在，8 个可写目录全部落在 G:/Agent-Demo/data，4 个配置文件只读，只有本机 5433/8080 两个宿主端口。
- git check-ignore 确认数据和实际 .env 忽略；PowerShell 脚本语法通过。再次初始化 RAGFlow 环境被拒，原文件哈希不变。
- G 盘为 NTFS，检查时可用约 18.4 GiB。临时目录中执行 chown/chmod 并以 postgres 用户 initdb 成功，目录显示 999:999 / 700；只创建测试数据库文件，没有启动数据库，测试目录随后清理。
- 以 UID 1000:GID 0 在真实 ES 数据目录创建并移除探测文件成功。
- Docker VM vm.max_map_count=262144；未修改系统参数。
- 独立只读审查通过：端口、路径、凭据匹配、Git 忽略、PG19 挂载、上游依赖与配置文件齐全；没有 Docker socket 或 privileged 服务。
- 镜像检查：PG/RAGFlow 摘要本地存在；其余 5 个依赖镜像缺失，未自动拉取。docker ps -a 确认没有遗留容器。
- git diff --check 通过；未重复运行与本轮无关的前端测试。

## 差异与未完成

用户明确要求取代此前 C/E 盘 named volumes 建议：本轮 PostgreSQL/RAGFlow 持久数据改为 G 盘项目 data/ 的 bind mounts。用户确认 PG19 取代 PG17；没有旧数据库需要迁移。Langfuse 不在本轮启动范围，其部署配置仍独立。

为小规模本地使用设置 ES heap 1GiB/上限2GiB，MySQL buffer pool/redo 各256MiB、日志过期3天，保持默认持久性设置；NTFS 首次初始化固定 lower_case_table_names=1。未以这些预算宣称完整系统性能已通过。

未启动业务服务，MySQL/ES/对象存储/Kvrocks/NATS 实际就绪、文档导入、模型下载与 API 联调仍未验证。临时目录测试不能证明长期数据库运行可靠性。G 盘容量需观察实际增长；ES 保留上游 5/3/2GB 水位限制，磁盘低于阈值会限制写入。

## 使用

当前工作区已经准备目录、环境文件和上游文件，后续获准启动时在项目根执行 docker compose up -d --wait --wait-timeout 600。详见 [本地 Docker 配置](docker-local.md)。无需在 Docker Desktop 的单镜像 Run 窗口逐个配置，启动后可从 Desktop 查看 Compose 项目。
