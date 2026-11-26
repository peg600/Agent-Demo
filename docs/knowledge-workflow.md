# 知识库问答与 Agent 工作流

TASK-008 r1 / DEC-009。本轮实现M2/M3的前后端代码。外部模型、RAGFlow、PostgreSQL和浏览器尚未联调；测试替身不作为真实服务可用证明。

## 已实现的链路

浏览器发送问题 → 同事务保存用户消息及queued运行 → 单进程执行器领取数据库租约 → LangGraph规划 → 校验依赖并按拓扑执行 → RAGFlow检索或本地拍场查询 → 汇总回答 → 同事务保存助手消息、来源及完成事件 → SSE通知前端读取历史。

工作流只开放知识问答、拍场查询/推荐和澄清三种任务。预约表单、竞买登记、支付及未知意图返回能力范围说明；不擅自提交业务。当前按子任务顺序拼接经过校验的回答，不额外让模型改写引用。拍场信息由业务PostgreSQL查询，始终标记虚构演示，不能当成官网实时档期。

前端仍使用 `/chat` 和 `/chat/:id`。页面显示当前运行、任务进度、取消、断线重连、错误及引用。回答正文只做文本展示，来源链接仅允许HTTP(S)。历史消息含持久化sources，刷新后仍可展示；旧存档消息保留原行为。

## 环境准备（本轮未执行）

除已有 `DATABASE_URL`、`SESSION_SECRET`、`WEB_ORIGIN` 外，需要：

| 变量 | 用途 |
| --- | --- |
| `CHECKPOINT_DATABASE_URL` | LangGraph检查点库连接，可指向同一业务库，使用独立workflow schema |
| `OPENAI_API_KEY`、`OPENAI_CHAT_MODEL` | 服务端模型调用，要求模型支持JSON Schema结构化输出 |
| `OPENAI_BASE_URL` | 默认OpenAI API地址，配置项只来自服务端环境 |
| `RAGFLOW_BASE_URL`、`RAGFLOW_API_KEY` | RAGFlow检索地址与凭据 |
| `RAGFLOW_DATASET_IDS` | 逗号分隔的知识库ID，最多20个 |
| `KNOWLEDGE_SOURCES_PATH` | 默认knowledge/sources.local.json，相对仓库根解析 |
| `RERANK_MODE` | openai（默认）或none；不是RAGFlow原生重排 |
| `MAX_TASKS_PER_MESSAGE` | 默认5，上限5 |
| `MAX_TOOL_CALLS_PER_RUN` | 默认8，上限8，含工具重试及崩溃恢复的保守计费 |
| `TOOL_TIMEOUT_MS`、`MODEL_TIMEOUT_MS` | 默认15000/60000；上限60000/120000 |

数据库准备后执行 `pnpm db:migrate`；第一次使用检查点时执行 `pnpm db:checkpoints`。前者应用Drizzle业务迁移0000–0002，后者由PostgresSaver初始化workflow schema，二者均写数据库，本轮未运行。正常启动不会自动应用迁移或setup。

将 [演示须知](../knowledge/demo-consultation.md) 上传到RAGFlow并完成解析和Embedding。复制 [来源样例](../knowledge/sources.example.json) 为knowledge/sources.local.json，填实际文档/知识库ID，核对版本及有效期后设approved=true。样例不是官方资料，默认未审核；本地映射文件已被Git忽略。细节见 [知识库接入](../knowledge/README.md)。

完成配置后用 `pnpm dev` 启动。后台调度器由API入口启用；测试构造buildApp默认不启动调度，不会因健康检查偷偷连接服务。配置缺失会产生明确的运行失败或无法确认答案，不自动切换到假回答。

## 接口与事件

新消息 `POST /api/conversations/:id/messages` 返回202、processing=queued和runId；同clientMessageId/同内容重试返回200及同一runId。旧存档消息重试仍返回not_configured，不自动花费模型调用。当前会话已有queued/running任务时，新消息返回409，用户可以等待或取消。

| 接口 | 行为 |
| --- | --- |
| `GET /api/conversations/:id/runs` | 最多20个运行，活动运行优先 |
| `GET /api/runs/:id` | queued/running/completed/failed/cancelled状态、固定错误信息、最后事件序号 |
| `GET /api/runs/:id/events?after=N` | SSE，支持Last-Event-ID（优先于query），按序号补发 |
| `POST /api/runs/:id/cancel` | JSON空对象，要求同源Origin，取消幂等 |

SSE统一 `event: run-event`，`id`为事件序号，data为共享RunEvent结构。包含run.started、plan.ready、task.started/completed、answer.delta、source及终态事件。每次批量读取重新检查身份；约15秒发送心跳。连接断开不取消后台运行。前端按序号去重、45秒空闲超时、最多5次退避重连，之后提供手动重连。

answer.delta是完整答案验证后保存的交付事件，**不是模型逐token流**。助手消息、答案事件、来源事件和run.completed在同一业务事务提交，避免崩溃后重复展示半份答案。执行进度会先于最终答案出现。

## 一致性和恢复

app.workflow_runs与app.run_events由Drizzle管理；messages增加run_id和sources。用户消息和运行同事务创建；每会话最多一个活动运行；最终助手消息按run唯一。访客归属在所有公开运行、事件和取消接口核验，不接受客户端owner字段。

执行器每秒扫描，以120秒租约领取任务，每20秒续租，总处理时限270秒；每次领取有新的租约令牌，最多3次崩溃接管。所有事件与终态写入核对令牌、状态、租约有效期。取消先持久化终态，后台最迟在续租或下一次事件写入时发现失效并中止；取消不能撤回已发出的模型请求或费用。

LangGraph使用qa-v1图版本和runId作为thread_id，通过PostgresSaver保存规划、工具预算和结果。执行器接管过期任务后读取检查点；已完成的图直接复用最终结果，未完成节点继续执行。恢复pending工具节点先增加预算，再允许重放。读操作可能重复，但不会重复保存助手消息。恢复次数、图版本不匹配或预算耗尽会安全失败，不无限重试。

同一run在检查点库持有会话级advisory lock，避免旧执行器与接管者并发写同一thread。锁连接查询按数据库超时等待实际结束，异常时销毁连接；不在后台查询还可能取得锁时提前归还连接。业务事务与检查点不是同一事务，所以采用“最终结果检查点 + 业务唯一约束/租约”处理崩溃间隙。

## 检索与模型边界

RAGFlow检索校验HTTP状态、业务code及返回结构；最多10个片段，只接受来源清单内已审核、生效且未过期、dataset/document匹配的内容，低相似度和空内容排除。模型重排只允许候选ID并去重取最多5个，重排失效回退原候选顺序；无相关证据返回无法确认。

回答采用结构化answer和citationIds。未知或缺失引用不作为有效知识答案发布；来源字段由清单与实际检索片段生成，模型不能生成任意来源。系统提示将用户历史、检索内容和依赖结果标为不可信数据；工具参数经过程序校验，不执行任意SQL、URL或脚本。引用存在不等于语义完全正确，后续仍须人工评估证据是否支持每项回答。

模型连接/服务端暂时失败最多重试一次；鉴权、配额和429不自动重试。规划结构/依赖错误最多修正一次，仍失败则澄清。工具可恢复失败最多重试一次，仍失败产生明确不可用说明，其余独立子任务可继续。

## 待联调与后续阶段

需要真实验证迁移、检查点setup、RAGFlow返回兼容性、OpenAI结构化输出、召回/重排质量、租约并发、进程重启、SSE断线、两访客隔离和浏览器展示。当前测试覆盖真实LangGraph配内存检查点及模拟服务/数据库协议，不等同于真实PostgreSQL事务验收。

本轮没有实现表单interrupt/resume、咨询提交、Langfuse追踪、正式账号登录或生产部署。后续按M4/M5单独实施。

实现参考：[Fastify Reply](https://fastify.dev/docs/latest/Reference/Reply/)、[Fastify关闭生命周期](https://fastify.dev/docs/latest/Reference/Lifecycle/)、[LangGraph持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[RAGFlow检索接口](https://ragflow.io/docs/http_api_reference)。OpenAI调用按已安装SDK声明实现。
