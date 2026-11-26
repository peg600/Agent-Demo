# 拍卖会与拍场实施结果

TASK-006 r1，待验收，2026-11-27。用户授权分模块实现并提交，完整环境联调可暂缓。对应架构版本6、DEC-007。

## 提交与实际修改

| 提交 | 内容 |
| --- | --- |
| 0945976 | 保存此前工程、开发依赖、Docker与文档修改 |
| 69274ab | 共享Zod目录契约、3场拍卖会/12个拍场的演示种子、来源核查记录 |
| ff12ac3 | PostgreSQL两表及生成迁移、事务幂等种子、只读目录接口和规则推荐、根数据库命令 |
| 30a01b4 | Vue列表/详情/筛选/推荐页面、公共组件、请求状态处理、健康页迁到/setup |

最后的交接提交包含此文档、架构/启动说明同步和Drizzle生成JSON格式整理；完整历史以git log为准。均为本地提交，未push。

数据与契约位于 packages/contracts/src/auctions.ts、apps/api/src/db/seeds/catalog.ts；官网来源核查见 knowledge/auction-sources.md。官网日程为动态页面，本次未提取具体场次；所有演示名称、日期、地址和数量都是虚构，不宣称已取得官网实时数据。

后端位于 apps/api/src/db、repositories/auction-repository.ts、routes/auctions.ts。提供拍卖会/拍场列表与详情、分页筛选、北京时间开拍日期范围和确定性规则推荐。只读查询限定isDemo记录；参数化SQL和LIKE转义；列表与计数在重复读事务内保持一致。无模型调用或内存自动降级，缺库返回503。

Drizzle生成app.auction_events/app.auctions的迁移，含外键、时间顺序、类别与数量约束及索引。种子先校验唯一ID、关联与日程，事务中按固定ID更新演示记录，遇到非演示同ID记录拒绝覆盖，不清空其他数据。

前端实现拍卖会列表、拍场目录、双方详情与关联导航、推荐理由；请求有Zod校验、15秒超时、旧请求取消、加载/空/错误重试状态。页面始终展示演示标识，时间以Asia/Shanghai显示，没有虚构的交易或预约按钮。详情官网链接仅为参考入口。现有健康检查e2e用例只更新到/setup。

## 验证证据

- corepack pnpm lint：通过，无错误/警告。统一Prettier负责3个额外Vue格式规则，语义检查保留。
- corepack pnpm typecheck：通过，contracts/API/Web三个workspace。
- corepack pnpm build：通过，前后端生产构建完成，Web146模块。
- corepack pnpm format:check：初次发现Drizzle两个生成JSON格式问题；格式化后再次通过。
- git diff --check、文档相对链接检查：通过。
- 独立只读审查：未发现阻止提交的问题；核对参数化查询、演示边界、时区、种子事务、迁移一致、错误脱敏和前端取消逻辑。
- 真实.env、data、vendor、node_modules不进入提交；没有修改系统或仓库Git身份设置，提交仅复用历史作者作为单条命令参数。

## 未运行与剩余工作

按用户要求暂缓完整环境跑通。本轮未执行Vitest、Playwright、数据库迁移/种子、Docker服务启动、模型调用或真实数据库HTTP联调。源码审查和构建不替代运行验收。已有数据库需后续按docs/auction-catalog.md应用迁移、播种并验证页面/接口。

本轮完成用户确认的拍卖会/拍场模块，不含完整客服Agent、会话历史、RAG问答、SSE、表单、中断恢复、Langfuse追踪或生产鉴权。固定日程会随实际时间过期，届时推荐为空是预期，不自动将历史数据伪装成进行中。

TASK-005原记录已归档到history/TASK-005/r1-01-*，未擅自改为已验收。新任务状态为待验收，未宣称Work已收到同步。
