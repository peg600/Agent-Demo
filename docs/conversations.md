# 会话与历史消息模块

TASK-007 r1 / DEC-008定义会话基础；TASK-008 / DEC-009接入智能问答与运行状态。前后端代码实现匿名身份、创建会话、保存用户/助手消息和读取历史，尚未进行真实PostgreSQL与浏览器联调。模型、SSE与只读任务恢复实现见 [工作流说明](knowledge-workflow.md)；表单仍属后续阶段。

## 本地入口与配置

前端入口为 `/chat`，具体会话为 `/chat/:id`。保持同源 Vite 代理 `/api`，浏览器访问 `http://127.0.0.1:5173`。首次访问或身份失效时，页面要求显式建立匿名身份；有效身份可以继续读取原历史。

服务端需要 `DATABASE_URL`、至少32字符的 `SESSION_SECRET` 和 `WEB_ORIGIN`（默认 `http://127.0.0.1:5173`）。这些变量只在服务端使用。已有 `scripts/init-local-env.ps1` 可准备本地密钥；不要覆盖已有环境文件或把密钥提交到Git。修改浏览器端口时同步修改 `WEB_ORIGIN`。

数据库准备好后，在仓库根目录执行 `pnpm db:migrate` 应用目录和会话迁移，再执行 `pnpm dev`。本任务没有执行上述写库步骤。会话模块不依赖目录种子或 OpenAI Key；缺少会话配置或数据库不可用时返回503，健康检查与公开目录路由仍独立注册。

## 接口

所有请求与响应契约位于 `packages/contracts/src/conversations.ts`。POST 使用 `Content-Type: application/json`；浏览器自动携带同源 cookie 和 Origin，服务端要求 Origin 严格匹配配置。

| 请求 | 输入和行为 |
| --- | --- |
| `POST /api/visitor-session` | `{}`；创建匿名身份或复用有效身份，响应仅含过期时间 |
| `POST /api/conversations` | `{clientConversationId, title?}`；标题默认“新会话”，最长100字符 |
| `GET /api/conversations` | `page`默认1，`pageSize`默认20、最多50；按最近更新优先 |
| `GET /api/conversations/:id` | 当前身份的会话详情及消息数量 |
| `POST /api/conversations/:id/messages` | `{clientMessageId, content}`；非空文本最多4000字符，只能写入user角色 |
| `GET /api/conversations/:id/messages` | `limit`默认30、最多50，`beforeSequence`可选；返回升序消息、hasMore和nextBeforeSequence |

新建会话返回201和duplicate:false；新用户消息与运行同事务入库返回202、processing=queued和runId。相同请求ID、相同规范化内容重试返回200和duplicate:true；同ID不同内容或会话已有另一活动任务返回409。TASK-007的旧存档消息仍返回not_configured/null，不自动创建运行。消息响应增加runId和sources，旧历史默认null/空数组。

参数错误400，身份无效或过期401，写入来源不符403，会话不存在或归属他人统一404；频率限制429，配置或数据库不可用503。前端不会自动用新的匿名身份掩盖401。

## 持久化与重试

`app.visitors` 保存访客；`app.visitor_sessions` 保存令牌HMAC摘要和固定30天有效期。原始随机令牌只放在HttpOnly、SameSite=Lax、Path=/的cookie中，当前仅本机HTTP开发使用。清除cookie、过期或更换SESSION_SECRET会失去旧匿名身份访问能力，当前没有账号找回机制。

`app.conversations` 绑定访客，按 `(visitor_id, client_conversation_id)` 唯一；`app.messages` 绑定会话，按 `(conversation_id, client_message_id)` 及 `(conversation_id, sequence)` 唯一。消息写入在事务中锁定所属会话，分配序号、增加计数、更新会话时间。查询与写入均检查服务端身份，客户端不能提供owner或role绕过归属。

历史读取从最新一页开始，按序号向前加载；新消息到来不会改变已存在消息的序号。会话目录使用页码分页，发送消息后排序可能变化，因此翻页不是跨请求冻结快照。

前端请求包含超时、响应校验、取消和过期结果保护；失败重试保留请求ID，编辑发送内容后使用新ID；切换会话不会把旧请求响应插入新会话。草稿和重试ID仅保留在客服组件内存中，刷新或离开客服模块会丢弃，此时应先查看历史确认上一次保存结果。界面只渲染文本，不把消息作为HTML执行。

## 后续验收

需要实际验证迁移、两名匿名访客隔离、刷新后的历史恢复、超过一页的消息、网络中断重试和并发写入。注入测试与类型检查不替代数据库事务或浏览器行为验证。TASK-008已增加助手消息、运行关联、SSE和只读任务检查点恢复；真实验证仍待执行。
