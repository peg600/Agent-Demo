# 知识库问答与 Agent 工作流实施结果

TASK-008 r1，待验收，2026-11-27。对应DEC-009、架构8。TASK-007任务与结果归档至history/TASK-007/r1-01-*，保留原待验收状态。

## 推送与提交

本轮开始先执行git push origin main，TASK-007的4个提交已推送，远程截止8147896。本轮新增模块提交先本地保存：

| 提交 | 模块 |
| --- | --- |
| 330dcfb | 工作流状态/事件/知识引用共享契约及任务记录 |
| a77d447 | 工作流运行、事件、幂等消息、租约状态与0002迁移 |
| 3fc1eb5 | RAGFlow/OpenAI、知识与拍场工具、LangGraph检查点、演示知识资料 |
| 0102127 | 后台调度、运行/取消接口、SSE与HTTP/执行器测试 |
| ef68266 | 前端执行状态、取消、重连、知识引用与解析/竞态测试 |

最后交接提交保存本结果、任务状态、架构及使用说明，完整提交号以git log为准。本轮新增提交未push。

## 实际实现

- 共享contracts新增运行状态、事件、来源；消息增加runId/sources。新消息与queued运行同事务保存返回202；同请求ID重试沿用同run，旧存档不自动创建任务；每会话最多一个活动运行。
- 新增workflow_runs/run_events及messages扩展迁移。运行领取采用行锁、120秒租约与独立令牌，20秒续期，270秒总时限，最多3次崩溃接管；旧租约不能发布结果。助手消息、答案事件、来源及完成状态一次事务提交。
- OpenAI结构化规划最多5项，校验任务ID/依赖/日期与无环顺序；最多8次工具尝试，包含重试和恢复保守计费。只开放知识、拍场和澄清任务。知识库使用RAGFlow检索，应用层模型重排、有效来源过滤和引用ID校验；缺少证据不编造知识答案。
- LangGraph真实StateGraph与PostgresSaver集成，runId作为thread_id。已完成检查点直接复用final，未完成节点恢复；PG advisory lock避免旧执行器与接管者同时写同thread。新增db:checkpoints命令但未执行。
- 运行详情、最近运行、取消与SSE接口复用cookie归属和Origin检查，支持Last-Event-ID/after补发。SSE约15秒心跳；客户端断线不取消任务。answer.delta是验证完成后的交付事件，不是逐token输出。
- 前端支持执行进度、取消、有限退避重连、终态历史合并、纯文本回答和安全来源链接；切换会话取消页面请求但不取消后台任务，401要求显式重新建立身份。
- 新增knowledge/demo-consultation.md虚构资料与默认未审核来源样例。KNOWLEDGE_SOURCES_PATH读取本地映射，sources.local.json被忽略；不自动上传文档或冒充官网规则。

关键文件：apps/api/src/agent、adapters、tools、repositories/workflow-repository.ts、routes/run-stream.ts；apps/web/src/composables/useWorkflow.ts、runEvents.ts与ChatView.vue。完整配置与行为见knowledge-workflow.md。

## 检查与修正证据

- corepack pnpm test：11个文件、63项测试通过。包含原会话回归、真实LangGraph+MemorySaver恢复/取消/预算、来源与引用校验、模拟数据库事务边界、worker fencing、HTTP/SSE归属/游标以及前端重连/竞态。
- corepack pnpm typecheck、lint、build：通过；Web构建154模块。
- corepack pnpm format:check：最终通过；中间worker格式问题已修正。
- git diff --check：通过。
- 独立安全审查未发现本地loopback范围内的阻塞问题。审查发现并修复：引擎与事务层重复发布答案事件；崩溃重放未增加工具预算；锁查询尚未结束时取消可能提前归还连接。新增3项mock PG锁生命周期测试验证等待查询settle、失败销毁和解锁顺序。
- 整合时修正可选clock的类型和测试tuple空值访问。没有安装新依赖，没有改动Git身份配置，没有提交真实.env、容器data或本地来源映射。

## 差异与未执行

实现范围为M2/M3，未包含M4表单interrupt/resume、咨询提交或M5完整Langfuse追踪。来源元数据当前使用本地JSON清单，原knowledge_sources数据库表留待管理阶段；状态记录和理由见DEC-009。答案按子任务顺序拼接，避免额外模型汇总改写证据。

未启动Docker、执行db:migrate/db:seed/db:checkpoints、上传或解析知识文档、连接真实PostgreSQL/OpenAI/RAGFlow/Langfuse、运行Playwright或浏览器联调。内存检查点、模拟SQL驱动和HTTP替身均不证明真实数据库并发与外部协议已通过。后续需按knowledge-workflow.md完成环境配置、迁移、检查点初始化和端到端验收。

取消会先保存终态，后台在下一续租/事件边界停止，不能撤回已经发出的模型请求或费用。引用ID校验不能证明语义完全忠实，仍需真实问题集检索和回答质量评估。

未向Work实际同步，不宣称Work已收到交接。任务保持待验收。
