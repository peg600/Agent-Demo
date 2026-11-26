# 拍卖会与拍场模块

TASK-006 r1。本模块提供本地演示目录，不接受竞价、付款、报名或咨询提交。与完整客服 Agent 的会话、RAG、SSE、表单恢复相互独立，不需要 OpenAI/RAGFlow/Langfuse 密钥。

## 数据与存储

- `app.auction_events`：拍卖会，包括城市、场馆、预展及拍卖时间。
- `app.auctions`：拍场，通过 `event_id` 关联拍卖会，包括类别、开拍时间、厅名及演示拍品数。
- 3场拍卖会、12个拍场均由人工虚构；出处边界见 [数据来源说明](../knowledge/auction-sources.md)。不含官网正在进行场次的已核实数据。
- 数据库存 `timestamptz`；API返回ISO时间，前端固定Asia/Shanghai展示。状态按请求时刻计算：开拍前为upcoming，开始至结束前为ongoing，达到结束时间为ended。
- 固定演示日程覆盖2026年8月、11月26–29日、12月5–6日。未来全部过期时推荐为空是预期，不会自动篡改日期。

## 后续初始化

以下命令尚未在本轮执行，需要业务 PostgreSQL 可用且根 `.env` 的 DATABASE_URL 已设置：

```powershell
docker compose up -d --wait postgres
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm dev
```

迁移文件位于 `apps/api/drizzle/`，由 Drizzle 实际生成；只有 app schema 的两张目录表，不包含 LangGraph 检查点、会话或表单表。首次应用前审查SQL。种子使用事务和固定演示ID，重复运行会更新同一批演示记录，不清空其他数据；如果相同ID已被标记为非演示，整个事务拒绝覆盖。

数据库未启动、未迁移或连接配置缺失时，目录接口返回503，页面显示可重试错误，不自动回退到内存数据。`/health/live` 仍只表示API进程存活。

## HTTP 接口

全部为公开只读 GET，默认仅本机访问；成功响应带 `meta.isDemo=true` 和 `meta.asOf`，列表另带 `total/page/pageSize`。

| 路径 | 参数 / 内容 |
| --- | --- |
| `/api/auction-events` | `q`、`city`、`status`、`page`、`pageSize` |
| `/api/auction-events/:id` | 拍卖会详情和所属拍场 |
| `/api/auction-sessions` | 上述筛选加 `eventId`、`category`、`dateFrom`、`dateTo`、`sort` |
| `/api/auction-sessions/:id` | 拍场详情和所属拍卖会 |
| `/api/auction-recommendations` | `city`、`category`、`limit`；返回拍场及推荐理由 |

分页默认1/12，pageSize最大50。`q`为最长100字符的字面包含搜索，不将百分号或下划线当作通配符。城市精确匹配。

类别：painting、porcelain、jewelry、wine、books、contemporary。状态：upcoming、ongoing、ended。拍场排序startAsc/startDesc，时间相同时按ID稳定排序。

`dateFrom`/`dateTo`是北京时间**开拍日期**，格式YYYY-MM-DD，首尾自然日均包含；内部使用[from日00:00，to次日00:00)范围。日期起点大于终点返回400。

推荐不调用LLM：先严格满足城市和类别，再排除已结束拍场；进行中优先，其余按开拍时间及ID排序，最多10条。没有匹配时返回空数组，不放宽筛选。

参数不合法400，合法ID不存在404，库不可用503，记录违反响应契约500。错误统一为 `{ error: { code, message } }`，不向客户端输出SQL、堆栈或连接信息。全部目录查询只读演示记录。

## 页面

| 页面 | 路径 |
| --- | --- |
| 拍卖会列表 | `/` |
| 拍卖会详情 | `/events/:id` |
| 拍场列表 | `/sessions` |
| 拍场详情 | `/sessions/:id` |
| 规则推荐 | `/recommendations` |
| 基础连接检查 | `/setup` |

页面有加载、失败重试、空结果和分页；筛选变化重置页码，详情路由变化重新加载，过期请求会取消。来源链接只表示官网参考入口，不表示演示场次真实存在。

## 验证边界

本轮执行类型检查、lint和生产构建；未执行数据库迁移/播种、HTTP真实数据库联调或浏览器验收。后续应检查持久化读写、分页/筛选、北京时间边界、种子重跑、无数据推荐、不可用重试和页面导航。浏览器原健康检查测试已迁移到 `/setup`，但本轮未执行。
