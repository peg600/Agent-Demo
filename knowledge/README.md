# 本地知识库接入

本目录的demo-consultation.md是虚构开发资料，不是中国嘉德官方规则。代码不会自动上传文档、创建数据集或启动服务。

后续联调时，将演示文档上传RAGFlow、完成解析与Embedding。复制sources.example.json为被Git忽略的sources.local.json，填入真实datasetId/documentId，人工核对内容、版本与有效期后设置approved=true。配置RAGFLOW_DATASET_IDS、RAGFLOW_API_KEY及模型变量；来源网址允许null，不能伪造官网出处。KNOWLEDGE_SOURCES_PATH可指定另一个服务端文件。

检索仅接受来源清单内已审核、生效且未过期的文档，阈值0.2，最多10个片段；OpenAI应用层重排后最多5个。没有有效证据时明确无法确认。文档更新后重新解析，更新映射和版本并禁用旧资料；来源清单不会自动修改RAGFlow文档状态。

本轮只实现适配器，未运行上传、解析、检索或模型调用。后续须测试真实返回字段、召回相关性、版本过滤和引用准确性。

实现依据：[RAGFlow HTTP API](https://ragflow.io/docs/http_api_reference) 的retrieval接口；[LangGraph持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)及已安装PostgresSaver 1.1.4声明。OpenAI接口依据本项目已安装SDK 7.65.0类型。RAGFlow和模型API兼容性仍须真实联调验证。
