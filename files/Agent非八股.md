# 1. AI Agent 面试题整理

## Chat Room评测与查错

RAG 和智能客服很常见，真正拉开差距的是评测集、召回/重排、权限、缓存和线上稳定性。

#### 1. 故障恢复

##### 1.1.状态怎么恢复

人为中断：

​ 中断的node会由checkpointer记录当前的state，恢复时通过thread_id从内存/缓存中恢复。

意外中断：

​ state会在并行的node(压缩，plan，工具调用，记忆落盘)运行之后merge并生成新state，随后通过3种不同的方式持久化到数据库。恢复时找namespace下最近的checkpointer恢复

##### 1.2.危险工具怎么审批

采用的不是“危险操作全部问人”，而是工业界常用的分层决策：

- `ALLOW`：合法的低风险只读工具自动执行。
- `REQUIRE_APPROVAL`：写入数据或产生外部副作用时逐调用审批。
- `DENY`：未知工具、参数非法、权限不足、审批过期等直接拦截，人不能越权放行。

最底层执行入口还有**第二道策略检查**，防止绕过 Graph 直接调用写工具，见 [planner.js (line 355)](/home/hyx/workspace/FSE-chatroom/backend/src/services/agent/planner.js:355)。

##### 1.3.调用轨迹怎么测试

##### 1.4.线上错误又怎么定位？

#### 2. 结果正确率

#### 3. 工具参数步数

#### 4. 波动（对话token消耗震荡）

#### 5. token消耗 耗时

#### 6. 幻觉 注入

### 2. 面试问题（部分）

### 1️⃣ 基础认知

- plan每次问答都调一次？
- Agent和普通Chatbot、和传统RPA的本质区别是什么？
- 一个完整的Agent一般包含哪几个核心模块？（记忆、规划、工具调用、执行反馈这套说不清楚基本就凉半截）
- ReAct是什么，跟单纯的Function Calling有啥区别？
- Agent的"记忆"分哪几种？短期记忆和长期记忆分别怎么落地？
  - **长期**记忆 - RAG(检索和写入)，入库，和system一个层级
  - **短期** - graph state + Checkpointer，单独子图，带long term副本
  - 长期记忆的挑战则在于「什么该存、什么不该存」以及「存了之后怎么管理」？
    -

- 一个prompt的典型构成（需要结合实例）
  - **系统指令**（静态配置，存在代码/配置里）
  - **对话历史**（压缩/摘要/滑动窗口，存在 DB + 缓存）
  - **长期记忆**（抽取/摘要/向量化，存在向量库 + DB）
  - **知识库检索结果**（RAG 召回，存在向量库/搜索引擎）
  - **工具定义**（静态 schema，存在代码/配置里）
  - **工具调用结果**（外部返回，存在运行时上下文/外部存储）
  - **任务状态 / Checkpoint**（快照，存在 DB/外部存储）
  - **约束与偏好**（结构化抽取，存在 DB/向量库）

### 2️⃣ 框架与工程实现类

- LangChain / **LangGraph** / AutoGen / CrewAI 用过哪个？为什么选它，踩过什么坑？
  - langgraph选型理由？

- MCP协议是干嘛的，最近为什么突然这么火，解决了什么之前的痛点？
- Function Calling底层模型是怎么"决定"该调哪个工具、传什么参数的？
- 工具调用失败了怎么办？重试机制、超时机制怎么设计？

### 3️⃣ RAG / 知识增强类

- Agent里用的RAG和普通问答RAG有什么不一样（比如要不要多轮检索、什么时机触发检索）？
- 检索结果不准导致Agent决策跑偏，你怎么解决？
- Chunk怎么切效果比较好？有没有真的因为切分策略翻过车？

### 4️⃣ 多智能体协作类

- 什么场景下必须上Multi-Agent，单Agent搞不定？
- Agent之间怎么通信、怎么分工？听说过Orchestrator模式吗？
- 多个Agent互相"甩锅"进入死循环，怎么兜底？

### 5️⃣ 工程落地 / 稳定性类

- Agent的成本怎么控制（Token消耗、调用次数、模型选型分级）？
- 怎么评估一个Agent做得好不好，有哪些具体指标？
- Agent出现幻觉、瞎调工具，线上怎么兜底？
- 生产环境怎么做Agent的可观测性（日志、Trace、埋点）？
- prompt注入怎么办？

### 6️⃣ 系统设计类（压轴大题，基本必考）

- 设计一个智能客服/代码助手/数据分析Agent，讲讲你的整体架构
  - 去南京的两天行程？下雨了怎么办？想压缩成一天怎么办？
- 如果任务要跑几十步才能完成，怎么保证Agent不跑偏、不断链？

## 模块治理

### 1. 上下文管理、记忆模块(缓存和入库)

#### 1.1. 怎么把记忆压缩进上下文窗口？

- **滑动窗口**：只保留最近 N 轮。触发：每次调用默认。
- **摘要压缩**：把旧对话总结成摘要，替换原始历史。触发：token 超过阈值（如窗口 70%）。
- **Checkpoint**：在关键节点（完成一个子任务、超步数）生成状态快照，后续只带快照不带全量历史。触发：步数超限或阶段完成。
- **分层摘要**：原始 → 分段摘要 → 全局摘要，逐层压缩。触发：历史长度分层增长时。
- **按相关性召回**：历史存入向量库，调用时只召回 top-k。触发：历史远大于窗口时。
- **结构化抽取**：只保留实体、目标、约束、决策等关键字段。触发：需要长期保留但不想带全文时。
- **工具/外部状态**：把中间结果存到外部（文件、DB），上下文只放引用。触发：中间产物大或可复用时。
- **丢弃 + 重载**：主动丢弃细节，需要时再检索回来。触发：上下文接近上限。

​ **<u>短期记忆</u>**主要保存当前会话的上下文和执行状态。在 LangGraph 中通常放在 Graph State，例如 messages、当前 plan 和 tool result，然后通过 Checkpointer 按 `thread_id` 持久化，这样多轮调用可以恢复同一个会话的状态。

​ **<u>长期记忆</u>**则是跨 **thread** 的，通常通过 LangGraph Store 按 `user_id` 或其他 namespace 保存用户偏好、历史事实和重要经验。长期记忆不会简单保存所有聊天记录，而是通过 memory extraction 筛选、归纳和去重，再以结构化数据或可检索文本写入 Store。下一次请求时，再根据用户 ID 或语义检索相关 memory 注入 context。

​ 因此从架构上看，LangGraph 的 `Checkpointer` 解决 **thread-level persistence**，`Store` 解决 **cross-thread memory**；实际送进 LLM 的 context 还需要单独做 trim、summary 和 memory retrieval。

#### 1.2. 短期记忆？

- **State = 当前时刻 Graph 的逻辑状态**（短期记忆的主体）

- **Checkpointer = 在执行过程中的特定时间点，把 State 持久化成 snapshot**（短期记忆的持久化机制）

- 什么时候触发check？Checkpoint 的“什么时候存”主要由 LangGraph Runtime 的执行边界 + durability 控制；长期 Memory 的“什么值得存”才主要是 Agent 的 memory policy。
  - checkpointer会触发在super-step完成，可能是并行的nodeA/B转移、merge后生成；
    - super-step（超步）:

      ```
      Super-step（超步） t:
      读取 State(t)
            ├── 所有当前可执行 Node
            ├── 并行执行
            └── 收集 state updates
                     ↓
                  Reducer
                     ↓
                State(t+1)
                     ↓
              下一个 super-step
      ```

  - 持久化'durability'：sync(慢) async(和下一个node parallel) exit(结束才落盘)

- 短期记忆在执行期间**表现**为进程中的 **Graph State**，并由 Checkpointer 按一定 durability 策略将 State snapshot 持久化到 backend（进程内存，或数据库服务）；下一次请求根据 `thread_id` 恢复最新 State。

#### 1.3. 怎么回忆出一个很久之前的约束？

### 2. Human in the loop，中断及恢复

### 3. 规划模块，能力边界限制

### 4. 工具调用模块，不可无限制

### 5. 反馈感知模块，下一步做什么

## 一、Agent 项目与架构设计

1.  详细描述你最近参与的 AI Agent 项目，包括架构设计和技术选型。
2.  AI 长文创作与会员拼团平台里，你是怎么搭建 Agent工作流并提升生成准确性的？
3.  你的项目里面实际用到了哪些 Agent 技术能力？
4.  智能康复训练平台主要解决什么业务问题？你在里面负责什么？
5.  智能康复训练平台里用到了哪些模型和工程技术？
6.  从架构角度分析 Tools、Workflow 和 Agent 三者的本质区别。
7.  Multi-Agent 系统如何设计三层架构？Agent 之间如何通信？
8.  如果一个 Agent 需要调用另一个 Agent，你会怎么做编排和防失控？
9.  当前阻碍 Agent大规模落地的最大挑战是什么？如何解决可控性和能力的平衡问题？
10. 从工程化角度看，Agent Harness 主要解决哪些问题？
11. 如何保证复杂 AI Agent 项目的开发进度和质量？
12. 从零搭建一个生产级 Agent 平台，你会按照什么顺序推进？

## 二、Agent 工具调用、Skills、MCP 与 A2A

1.  工具库有上百个工具时，如何让模型快速、准确地选择工具？
2.  Agent 执行过程中遇到工具调用失败（如支付接口超时）如何处理？
3.  如果要给 Agent 生成一个 Skill，并通过 MCP
    接入外部能力，你会怎么设计？
4.  MCP、A2A、Skills 和 Function Call 分别是什么？它们之间有什么区别？
5.  如何设计 Agent 的工具选择、参数校验和执行机制？
6.  Agent 调用外部系统时，如何控制权限和副作用？

## 三、Agent 稳定性、异常处理与故障治理

1.  Agent 如果出现死循环怎么办？异常处理机制如何设计？
2.  Agent 执行过程中工具调用超时、失败或返回异常数据时如何处理？
3.  如何处理高并发下的 panic、内存泄漏等稳定性问题？
4.  Agent 链路超时时如何设计超时、重试、熔断和降级？
5.  如何实现 Agent 的断点续执行？
6.  如何实现 Agent 系统的无损发布？
7.  如何设计 Agent 系统的高可用机制？
8.  如果 Agent 的决策出错导致数据误删，系统设计上如何防范？
9.  如何设计 Agent 的幂等机制，避免重复执行产生副作用？

## 四、上下文工程与 Memory

1.  长上下文对话中，如何让 Agent不忘记关键信息？除了向量检索还有什么方法？
2.  Agent 的上下文工程有哪些主流技术？如何设计有效的上下文管理策略？
3.  如何治理上下文膨胀问题？
4.  如何在有限 Context Window 下保留长期任务中的关键信息？
5.  短期记忆、长期记忆和外部知识库应该如何分工？
6.  如何避免不同会话之间的上下文串扰？
7.  Multi-Agent 场景下，不同 Agent 之间应该共享哪些上下文？

## 五、Agent 推理、规划与决策

1.  Tree of Thoughts 在线上系统中能用吗？如何平衡成本和效果？
2.  用户提出模糊需求，例如"按老样子帮我订一下"，Agent 应该如何处理？
3.  如何防止 Agent 在信息不足时自行猜测用户意图？
4.  Agent 如何进行任务规划、执行、反思和重新规划？
5.  如何设置 Agent 的最大执行步数、Token Budget 和停止条件？
6.  如何防止 Agent 陷入循环调用和无效推理？

## 六、Agent 评测与可观测性

1.  如何量化评估一个上线的 Agent 好坏？除了准确率还有哪些指标？
2.  如何评估 Agent 的任务完成率？
3.  如何评估工具调用准确率？
4.  如何评估 Agent 的规划质量和执行质量？
5.  如何评估幻觉率和事实一致性？
6.  如何评估 Agent 的端到端延迟，包括 P50/P95/P99？
7.  如何评估 Agent 的 Token 消耗和单任务成本？
8.  如何建立 Agent 的线上观测指标体系？
9.  如何设计 Trace 来定位 Agent 在 Planning、Tool Call、Retrieval 或
    Generation 中的问题？

## 七、性能优化、模型调度与成本控制

1.  如何降低 Agent 系统的 P95 响应时间？
2.  如何优化 Agent 中的向量检索性能？
3.  如何解决 Agent 资源瞬时打满的问题？
4.  如何设计 Agent 缓存架构？
5.  如何降低 Agent 的 Token 成本？
6.  如何进行大小模型之间的能力和成本平衡？
7.  如何设计多模型路由与调度策略？
8.  什么请求适合直接走小模型，什么请求应该升级到大模型？

## 八、RAG、Elasticsearch 与检索

1.  Elasticsearch 在 RAG 系统中的作用是什么？如何优化检索性能？
2.  Elasticsearch 和向量数据库在 RAG 中分别适合解决什么问题？
3.  如何设计关键词检索与向量检索的 Hybrid Search？
4.  RAG 中召回、重排和生成三个阶段分别如何优化？
5.  如何评估 RAG 的召回质量和最终回答质量？
6.  如何降低向量检索延迟？
7.  如何选择 Chunk 大小、Overlap 和 Top-K？

## 九、Kafka 与异步任务

1.  Kafka 在 AI Agent 系统中可能用于哪些场景？如何保证消息顺序性？
2.  Agent 的异步任务应该如何进行堆积和消费？
3.  **如何处理 Agent 任务重复消费？**
4.  如何设计任务重试和死信队列？
5.  如何保证同一会话或同一任务的消息顺序？
6.  **Agent 系统为什么可能需要消息队列，而不是全部使用同步 RPC？**

## 十、Redis

1.  AI 长文创作与会员拼团平台里，Redis 主要解决了哪些问题？
2.  Redis 和 MySQL 同时存业务状态时，怎么保证最终一致性？
3.  Redis 里的分布式锁具体使用了什么方案？
4.  直接用 SET NX 做分布式锁有什么问题？和 Redisson
    这类开源锁有什么区别？
5.  Redis 的 ZSet 底层是怎么实现的？
6.  Redis 跳表的查询复杂度是多少？为什么适合实现 ZSet？
7.  **Agent 系统中 Redis 可以用于哪些场景？**
8.  Redis 如何用于会话状态、缓存、限流和分布式锁？

## 十一、MySQL 与数据库

1.  MySQL 里的脏读和幻读分别是什么？数据库通常怎么避免？
2.  B 树和 B+ 树在数据库索引里的核心区别是什么？
3.  为什么 MySQL 索引使用 B+ 树，而不是 Redis 跳表这类结构？
4.  Redis 和 MySQL 同时维护业务状态时如何保证最终一致性？
5.  Agent 执行涉及数据库写操作时，如何保证事务安全？
6.  Agent 错误执行数据库操作时，如何设计回滚机制？

## 十二、并发、任务隔离与平台工程

1.  如何实现 Agent 会话隔离，防止不同用户之间的数据串扰？
2.  如何治理大量异步 Agent 任务堆积？
3.  如何设置 Agent 并发上限和资源配额？
4.  如何实现多租户 Agent 平台的数据和资源隔离？
5.  如何避免单个 Agent 任务耗尽系统资源？
6.  如何设计 Agent Worker Pool？
7.  如何处理长任务和短任务之间的资源竞争？

## 十三、团队协作与技术决策

1.  在团队中如何推动 AI Agent 项目的技术选型和架构演进？
2.  当团队成员对技术方案有分歧时，你如何沟通并达成共识？
3.  如何通过 PoC、Benchmark 和线上指标进行技术选型？
4.  如何保证 Agent 项目快速迭代的同时不牺牲稳定性？
5.  如何划分 Agent 项目中的模型层、平台层和业务层职责？

## 十四、Agent 技术趋势与开放题

1.  你怎么看最近 Agent 技术的发展方向？哪些方向更容易工程落地？
2.  你对当下 Agent 能力怎么看？
3.  当前阻碍 Agent 大规模落地的最大挑战是什么？
4.  对于 AI Agent 领域的未来发展，你有什么看法和规划？
5.  最近在学习和研究哪些 AI 相关的新技术或论文？
6.  你是如何系统性地学习一门新技术的？会关注哪些资源？
7.  你认为 Agent 从 Demo 到生产系统最大的技术鸿沟是什么？

---

# 补全答案（基于 FSE-chatroom，2026-09-20）

## 阅读约定与项目事实边界

- **已实现**：仓库中有运行代码和自动化测试。
- **部分实现**：已有核心闭环，但生产部署还缺少基础设施或规模化验证。
- **设计建议**：是适合本项目下一阶段的方案，不能说成“项目已经使用”。
- **本项目未采用**：Redis、Kafka、MySQL、Elasticsearch、向量数据库和 A2A/Multi-Agent 当前都不在依赖或运行链路中。生产主存储是 MongoDB；本地开发和测试使用 JSON Mock。

主要代码证据：

- 规划与结构化输出：[planner.js](../backend/src/services/agent/planner.js)、[action-protocol.md](../backend/src/pre-prompt/action-protocol.md)
- LangGraph 编排与中断恢复：[workflow.js](../backend/src/services/agent/workflow.js)、[checkpointer.js](../backend/src/services/workflow/checkpointer.js)
- 工具策略与逐调用审批：[toolPolicy.js](../backend/src/services/agent/toolPolicy.js)
- 工作流审计：[state.js](../backend/src/services/workflow/state.js) 及 `WorkflowRun/Step/Event`、`ToolCall`、`Approval` 模型
- 记忆：[memory/](../backend/src/services/agent/memory/)、[AgentMemory.js](../backend/src/models/AgentMemory.js)
- 评测：[evaluation.js](../backend/src/services/agent/evaluation.js)
- MCP：[client.js](../backend/src/services/mcp/client.js)、[mcp.js](../backend/src/services/agent/tools/mcp.js)
- 验证用例：[backend/tests](../backend/tests/README.md)

## Chat Room 评测与查错补充

### 1.3 调用轨迹怎么测试？

**已实现。** 不断言模型“想了什么”，而断言可观察状态迁移：计划是否合法、是否创建 Run/Step、危险工具是否先产生 interrupt、ToolCall 是否记录输入输出和耗时、Event 顺序是否正确、恢复后是否只执行一次。单元测试注入确定性的 Planner/Tool double；集成测试从 HTTP 入口验证所有权、审批、执行和审计查询。关键用例是 `agentWorkflow.test.js`、`humanInterruptWorkflow.test.js`、`toolPolicy.test.js` 和 `api.test.js`。

推荐把一次运行表示为：`trace_id/run_id → planning → approval → execute_tool → checkpoint → finalize`。当前 `WorkflowEvent` 已能还原业务轨迹；生产环境再接 OpenTelemetry span，并按 `sessionId/runId/stepId/toolCallId` 关联日志。测试只验证事件类型和因果关系，不绑定脆弱的完整日志文本。

### 1.4 线上错误怎么定位？

先按层定位，而不是只看最终 500：

1. API 层看 `runId/sessionId/userId`、HTTP 状态和认证结果。
2. Planning 看模型、Prompt 版本、结构化输出校验错误、规划耗时与 Token。
3. Retrieval/Memory 看召回项、摘要版本、压缩率和命中来源。
4. Tool 看 action、参数摘要、策略决策、重试次数、耗时、外部状态码。
5. Workflow 看最后成功节点、checkpoint、interrupt、幂等键和终态。

当前项目已有 WorkflowEvent、ToolCall、错误分类、延迟/Token 汇总；仍缺统一的分布式 `trace_id` 和 OTel exporter，所以属于**部分实现**。敏感参数默认应脱敏或只记录 digest，不能把用户全文、密钥和工具返回原样打进日志。

### 2. 结果正确率

不能只报一个 accuracy。至少拆成：任务完成率、计划可执行率、参数 Schema 通过率、工具选择准确率、工具执行成功率、事实一致性、拒答正确率和副作用安全率。当前项目能自动统计任务/工具成功率、错误类别、步骤数、延迟和 Token；尚缺带标准答案的离线评测集，因此不能声称已有“业务正确率”。

离线集应覆盖普通对话、权限拒绝、缺参数、天气条件发布、工具超时、重复请求、Prompt 注入和断点恢复；每次 Prompt、模型或工具协议变更都跑回归。线上用成功率、人工接管率和用户纠错率监控分布漂移，再把失败样本匿名化回灌离线集。

### 3. 工具参数与步数

参数质量看 `action type accuracy`、必填字段正确率、Schema 一次通过率、参数值事实正确率和人工修改率。步数看成功任务的实际 ToolCall 数与最短可行步数之比，而不是越少越好。项目在 `action-protocol.md` 把计划限制为最多 8 步，并用 Ajv 对每个 action 参数做服务端校验；执行前 `toolPolicy.js` 再校验一次，避免只信模型。

### 4. 波动（对话 Token 消耗震荡）

按相同评测集重复运行，统计 input/output/total token 的均值、P50/P95、变异系数和异常点，同时固定模型版本、temperature、Prompt 版本和召回配置。项目已持久化供应商 usage，并在评测接口汇总 Token；记忆模块通过 6000 token 触发阈值、3000 token 近期窗口和滚动摘要抑制上下文无界增长。近似 tokenizer 只能做窗口保护，计费和正式评测应以供应商 usage 为准。

### 5. Token 消耗与耗时

拆分 `planning / retrieval / tool / approval wait / generation / end-to-end`，分别看 P50/P95/P99。成本计算应使用“模型版本 + 输入/缓存输入/输出/推理 Token + 当时价目快照”，不能用总 Token 乘一个长期不变的价格。项目现已统计 Planning 与端到端分位数及 Token 汇总，但没有价格表，所以只报告用量，不伪造金额。

### 6. 幻觉与 Prompt 注入

幻觉治理依赖“有来源的事实 + 受限动作”，而不是只加一句系统提示：知识回答要求引用证据；工具输出按不可信数据处理；模型不能直接访问 DB/网络；action 必须在 allowlist；参数经 JSON Schema；写操作经 RBAC、逐调用审批和执行入口二次鉴权。记忆摘要明确把历史文本标注为数据而非指令，降低持久化注入风险。

测试应包含直接注入、检索文档间接注入、工具返回注入、越权 action、参数走私、审批后篡改和长期记忆污染。项目已覆盖越权、Schema、审批绑定和记忆数据边界；尚缺成体系的红队语料库，属于下一阶段工作。

## 基础认知与框架类补充

### plan 每次问答都调一次吗？

本项目空输入走确定性欢迎页，不调用模型；正常非空消息进入一次 Planning Graph。普通对话也会规划成 `conversation`，但不会生成 Todo 或调用工具；command 才进入持久化 Run 和后续执行图。工业上不应把所有请求都强制做复杂规划：FAQ/明确单工具请求可走轻路由，复杂、多约束或高风险任务才升级为显式 plan/replan。

### Agent、普通 Chatbot、传统 RPA 的本质区别

- Chatbot 主要生成回复，状态和外部动作通常有限。
- RPA 走预定义流程，确定性强，但遇到开放语义和环境变化适应差。
- Agent 用模型在能力边界内动态选择步骤和工具，并根据执行反馈继续、暂停或终止。

FSE-chatroom 的 Agent 性体现在模型生成受约束 Todo、LangGraph 执行、工具反馈和 checkpoint；其边界仍是服务端白名单，并不是“模型拥有系统权限”。

### 一个完整 Agent 的核心模块

输入/身份、上下文与记忆、Planner、能力/工具注册、策略与审批、执行器、状态/checkpoint、反馈与重规划、评测/Trace、预算和停止条件。当前项目除通用 RAG、模型路由和完整 OTel 外已有最小闭环。

### ReAct 与 Function Calling 的区别

Function Calling 是模型输出结构化工具名和参数的接口机制；ReAct 是“观察—推理—行动—再观察”的循环范式。Function Calling 可以只调用一次，也可以被 ReAct 循环使用。生产环境通常保留结构化 action 和可审计状态，不持久化或展示模型隐藏推理链；本项目更接近“Plan-and-Execute + Function Calling contract”，不是开放式无限 ReAct。

### 长期记忆该存什么、怎么管理？

只存跨会话仍有价值、可解释且允许持久化的事实，例如明确偏好、稳定约束和长期任务状态；不自动保存寒暄、敏感信息、未经确认的模型推断和短期工具噪声。需要来源、作用域、版本、过期时间、冲突覆盖、删除/导出能力和召回审计。当前项目采取保守策略：只有用户明确说“请记住/remember”才写入 `AgentMemory`，最多保留 100 项；这比自动抽取安全，但还缺过期、用户管理和语义向量检索。

### 怎么回忆很久以前的约束？

以 `userId + namespace` 过滤，先做权限隔离，再用当前问题检索长期事实，按相关性、时效性和置信度取 Top-K，连同来源注入 system memory；若约束冲突，以后来的明确更正覆盖并提示用户确认。项目目前用词项重合检索显式事实，跨 session 测试已验证“集合点是北门”；规模增大后可替换为 hybrid retrieval，但接口不变。

### 为什么选 LangGraph？踩过什么坑？

本项目实际使用 LangGraph，没有使用 AutoGen 或 CrewAI。选择原因是有显式 State、条件边、checkpoint、`interrupt()/Command(resume)` 和可注入节点，适合审批与长任务，不必手写隐式 while-loop。项目踩到的关键坑包括：checkpoint 不等于并发锁；节点重放要求副作用幂等；runtime 函数不能进 checkpoint；Graph state 与业务数据库不能形成两个互相竞争的真相源；interrupt 前后的代码可能重放。当前用 thread lock、稳定幂等键和 WorkflowRun/Step 作为审计事实源缓解，生产仍需数据库 saver、租约/outbox。

### MCP 是什么，为什么火，解决什么痛点？

MCP 标准化“AI 应用如何发现并调用工具、读取资源和使用提示模板”，减少每个模型客户端为每个 SaaS 重写私有适配器。它解决的是 Agent-to-tool/context，不等于业务授权，也不等于 Agent-to-Agent。项目把天气 action 映射到 MCP Streamable HTTP，并在适配层转换内部参数，凭证保留在服务端。

截至 2026-09，官方最新正式规范为 `2026-07-28`，重点转向无状态 HTTP、可缓存列表结果、Tasks 扩展和更严格授权；本项目不能仅凭 SDK 版本宣称完全合规，升级时应跑协议兼容测试。

### Function Calling 底层如何决定工具和参数？

工具名、描述和 JSON Schema 被编码进模型上下文，模型根据当前指令和对话预测“普通文本”或某个 tool call，再生成满足 Schema 的参数 token。它是概率决策，不是后端路由器，所以描述冲突、工具过多和上下文污染都会误选。项目让模型只产出 action JSON，服务端随后做 Schema、allowlist、RBAC 和 effect policy 校验。

### 工具失败后的重试和超时怎么设计？

先分类：参数/权限错误立即失败；网络、429、5xx 可在预算内重试；业务冲突交给模型修正或用户；未知错误上抛并告警。只读、幂等操作可指数退避加 jitter；写操作必须有幂等键、事务或补偿，不能盲重试。项目的 LLM、摘要和 MCP 都有超时，天气 MCP 新增最多 3 次瞬态重试；`post.publish` 使用 `runId:stepId` 幂等键，失败 Run 由显式 retry API 恢复。

## RAG / 知识增强补充

### Agent RAG 与普通问答 RAG 有什么不同？

普通问答通常是一次“检索—生成”；Agent RAG 还要决定何时检索、是否改写查询、是否多跳检索、结果是否足以继续以及检索结果能否作为动作依据。它还必须把检索文档视为不可信数据，不能让文档直接授权工具。当前项目只有记忆检索，不是完整知识库 RAG，面试时必须明确这一点。

### 检索不准导致决策跑偏怎么解决？

先分解为召回错、排序错、切块错、元数据过滤错还是生成未忠实使用证据。常用改进是 query rewrite、BM25 + dense hybrid、元数据/权限过滤、RRF、cross-encoder rerank、置信阈值和“不足则澄清”。动作前还要用业务系统重新验证关键事实，不能拿 RAG 文本直接执行写操作。

### Chunk 怎么切？

优先按文档结构和语义边界切，不机械固定字符；表格、代码、FAQ、流程文档使用不同 splitter，并保留标题、来源、版本和父子关系。起始值可用 300–800 tokens、10%–20% overlap，但最终由 Recall@K、nDCG、faithfulness、延迟和 token 成本共同调参。常见翻车是把条件与结论拆开、重复 overlap 造成排序污染、旧版本和新版本同时召回。

## Multi-Agent 补充

### 什么场景必须上 Multi-Agent？

几乎没有“必须”。只有角色需要不同权限/上下文、任务能独立并行、跨组织由不同团队拥有，或需要独立验收者时才值得上。单 Agent + 确定性 workflow 能解决就优先单 Agent；本项目当前没有 Multi-Agent，天气、发帖等只是 Tools。

### Agent 如何通信和分工？Orchestrator 是什么？

Orchestrator 负责拆解、派工、预算、汇总和终止；Worker 只接收最小任务包，返回结构化结果/证据。进程内可用 typed message/state，跨服务可用队列或 A2A。A2A v1.0 提供 Agent Card、任务和多种协议绑定，适合独立 Agent 的互操作；MCP 则更适合 Agent 调工具，两者不能混为一谈。

### 多 Agent 死循环怎么兜底？

设置全局步数、每 Agent 步数、Token/时间/金额预算、重复消息指纹、相同状态无进展检测、最大转交次数和 DAG 边约束；超限后交还 Orchestrator 或人工。每次委派携带 task id、parent id、deadline、幂等键，禁止 Agent 自行无限创建新 Agent。

## 工程落地与系统设计补充

### 成本怎么控制？

先减少无效调用：轻重请求路由、Prompt/工具裁剪、历史压缩、检索 Top-K、并行独立步骤、缓存确定性结果和失败快速返回；再考虑小模型优先、大模型升级。按任务而非单请求统计 token、工具费和重试放大。项目已有限步、上下文压缩、空输入不调模型和 usage 统计；尚未实现多模型路由与语义缓存。

### 怎么评估 Agent？

核心是任务成功率；配套指标包括工具/参数准确率、步骤效率、事实一致性、拒答正确率、副作用事故率、人工接管率、恢复成功率、P50/P95/P99、Token/任务和成本/成功任务。离线 golden set、仿真工具和线上指标必须同时存在。

### 幻觉、瞎调工具线上怎么兜底？

回答侧要求证据和置信阈值；执行侧用最小权限、Schema、allowlist、RBAC、dry-run、审批、幂等、事务/补偿和速率限制。FSE-chatroom 的写工具审批绑定 actor/run/step/参数 digest，审批后篡改会被拒绝，未知工具永不执行。

### 生产可观测性怎么做？

一条 trace 覆盖 HTTP → planning → memory/retrieval → policy → tool → checkpoint → finalization；持续记录模型/Prompt 版本、Token、重试、缓存命中、节点耗时和错误类型。正文、工具参数和结果属于敏感内容，默认不记录或采样脱敏。项目已有业务事件和评测聚合，生产应补 OpenTelemetry exporter 与告警 SLO。

### Prompt 注入怎么办？

把 system/developer policy、用户输入、检索数据和工具结果分层；外部内容只作为数据；工具权限由代码决定；高风险输出走审批；对 URL/文件/HTML 做净化和来源标记；长期记忆写入必须保守。不要依赖关键词黑名单，因为注入可以编码、跨语言或隐藏在工具结果里。

### 设计智能客服/代码助手/数据分析 Agent

通用架构是入口鉴权 → 意图/风险路由 → 上下文与检索 → Planner → 策略网关 → 工具执行 → checkpoint/事件 → 答案与引用 → eval/trace。对“南京两日行程”先形成约束化 itinerary；下雨是新 observation，触发局部 replan；压成一天则改变时间预算后重排，而不是推翻所有已确认约束。涉及预订/支付时必须逐调用确认。

### 几十步任务如何不跑偏、不断链？

把长期目标、硬约束、完成定义和剩余预算结构化存入 state；计划分阶段，每阶段有验收条件和 checkpoint；工具结果更新事实表，不把全量原文反复塞回 Prompt；定期比较“当前状态 vs 目标”，只有证据变化才 replan。副作用步骤必须幂等，失败按 checkpoint 恢复，超预算交人。

## 模块治理补充

### Human in the loop、中断与恢复

审批不是一个前端弹窗，而是持久化状态机：先校验权限和参数，保存待审批 action 与 digest，Graph `interrupt()` 暂停；用户以 interrupt id 回复 approve/edit/reject；恢复时重新校验 TTL、actor、run、step 和参数 digest，再生成短期 grant 执行。项目已完整实现并测试编辑后恢复、拒绝终止、过期和 stale interrupt 防护。

### 规划模块与能力边界

能力边界由服务端 `capabilities.md + tools.md + handler registry` 三方一致性决定，模型不能声明新能力。Planner 输出最多 8 步；普通对话不得带 Todo；天气条件发布只能先查天气，再由独立判断节点生成待审批发布步骤。无法覆盖、权限不足或参数不合法都应显式 rejected，而非“尽力猜”。

### 工具调用为什么不可无限制？

限制工具 allowlist、单计划步数、单工具参数、超时、重试预算、并发、速率和副作用审批。还要检测相同 action+arguments 重复、连续无进展和累计成本。当前项目已限制 8 步、API 120 req/min、MCP 超时/只读重试和危险工具审批；尚缺租户级并发与金额预算。

### 反馈感知后下一步做什么？

工具结果先结构化为 observation，再判断：成功且满足验收条件则推进；缺信息则 interrupt 用户；瞬态失败按预算重试；参数可修复则 replan；高风险新动作重新审批；不可恢复则 handoff。项目执行图目前成功后走下一 Todo、失败终止、天气结果可追加新审批步骤；它不是开放式自由反思循环，这是为了可控性。

## 一、Agent 项目与架构设计——逐题回答

1. **最近的 Agent 项目。** 可用 FSE-chatroom 作答：它是应急协作聊天系统上的受控 Agent。Vue/Express/Socket.IO 负责交互，MongoDB 负责业务与审计状态，LangGraph 分为 Planning Graph、Execution Graph 和 Memory Graph，MCP 接天气，工具策略负责 Schema/RBAC/审批。选择小图而非“大而全自主 Agent”，因为核心目标是可审计副作用与断点恢复。

2. **AI 长文创作与会员拼团平台。** 本仓库没有该业务，不能声称参与过。若这是个人真实经历，应按“素材检索 → 大纲 → 分段生成 → 一致性检查 → 人审发布”和“拼团状态机/支付幂等/超时关团”分别讲；FSE-chatroom 可借鉴的是结构化计划、状态持久化、审批和幂等，而不是业务成果。

3. **实际使用的 Agent 技术。** Structured Output/JSON Schema、LangGraph 条件图、checkpoint、HITL interrupt/resume、短期摘要与显式长期记忆、Tool/MCP、RBAC policy-as-code、幂等副作用、工作流审计、离线单测和在线聚合指标均已使用。完整知识库 RAG、多模型路由、A2A、多 Agent 没有使用。

4. **智能康复训练平台解决什么问题、负责什么。** 本项目不是康复平台，不能编造职责。可诚实回答“我当前可展开的是应急协作 Agent”；如果简历确有康复项目，应给出真实用户、训练闭环、医学风险边界和本人代码/指标，否则宁可删掉该项目。

5. **康复平台用了哪些模型与工程技术。** 同上，无仓库证据不能声称模型。合理方案会包含姿态/动作识别、时序评分、个性化处方、边缘推理、隐私合规和人工治疗师复核，但这些只是设计建议。

6. **Tools、Workflow、Agent 的本质区别。** Tool 是有明确输入输出和副作用的原子能力；Workflow 是开发者预先定义的控制流；Agent 让模型在边界内动态选择下一步。FSE-chatroom 中天气/发帖是 Tool，审批执行图是 Workflow，Planner + Workflow + Memory 才组成 Agent。

7. **Multi-Agent 三层架构。** 建议分为控制面（Orchestrator、预算、身份和策略）、Agent 面（领域 Agent、状态与能力声明）、执行面（Tool/MCP、队列、数据源）。通信使用带版本的结构化 envelope，包含 task/parent/tenant/deadline/idempotency/context refs；共享事实和产物引用，不共享隐藏推理。当前项目不需要这层复杂度。

8. **一个 Agent 调另一个 Agent。** 把被调 Agent 当远程、有限权限的异步服务：先能力发现，再创建带预算的子任务，轮询/订阅状态，校验 artifact 后合并。限定委派深度、扇出、超时和取消传播；跨团队可采用 A2A v1.0，内部单体优先普通函数或子图。

9. **最大落地挑战。** 不是模型不会调用工具，而是非确定模型与确定性业务约束之间的鸿沟：权限、数据质量、评测、长任务恢复、副作用一致性和事故责任。平衡方式是“模型负责候选决策，代码负责边界和提交”，风险越高，自由度越低。

10. **Agent Harness 解决什么。** Harness 是模型之外的运行外壳：Prompt/模型装配、工具注册、状态、预算、重试、checkpoint、权限、沙箱、Trace、评测和 HITL。项目的 planner/workflow/memory/toolPolicy/state 合起来就是一个轻量 Harness。

11. **如何保证进度和质量。** 先垂直切一个可验收闭环，再按风险补能力；契约先行，模型和工具都可替换；确定性测试覆盖策略与状态机，provider-dependent eval 单独跑；每次上线有 Prompt/模型版本、回滚和观察窗口。不要用“Demo 能聊”代替完成定义。

12. **从零搭生产级平台的顺序。** 业务目标与风险分级 → golden set/SLO → 身份和数据边界 → 最小 Tool contract → 单 Agent workflow → 审批/幂等/审计 → checkpoint/recovery → 线上观测 → 模型路由和缓存 → 必要时 RAG/Multi-Agent。FSE-chatroom 已走到中间阶段，生产数据库 checkpointer、OTel、租户配额和部署 HA 仍待补。

## 二、Agent 工具调用、Skills、MCP 与 A2A——逐题回答

1. **上百工具怎么选。** 不把 100 个完整 schema 一次塞给模型。先按租户、角色、场景做 capability filtering，再用意图路由/embedding 检索 Top-N 工具，必要时分层 namespace；对相近工具合并接口或增加反例。最终仍由服务端校验。当前项目只有 5 个 action，直接清单更简单。

2. **支付接口超时。** 超时状态是“未知结果”，不能立即重复支付。使用业务幂等键查询原交易，若可确定未提交才重试；否则进入 reconciliation/人工核对。重试用指数退避、总 deadline 和熔断，失败写审计/死信。项目的帖子幂等模式可类比，但不是支付级事务实现。

3. **生成 Skill 并通过 MCP 接能力。** Skill 应描述何时用、输入输出、边界、失败处理和验证步骤；MCP Server 暴露版本化 Tool Schema，Adapter 做领域 action 到外部协议的转换；策略层再加身份、scope、超时、审计和审批。项目天气 action 没把 Open-Meteo 原始字段直接暴露给 Planner，就是这一层隔离。

4. **MCP、A2A、Skills、Function Call。** Function Call 是模型产生结构化调用；Tool 是可执行能力；MCP 是 Host/Client 与外部工具/资源的互操作协议；Skill 是可复用的操作知识和流程说明；A2A 是独立 Agent 之间发现、任务和 artifact 交换协议。关系是“Skill 教怎么做，Function Call 表达要调用什么，MCP 连接工具，A2A 连接 Agent”。

5. **工具选择、参数校验和执行机制。** 选择阶段只给最小候选集；参数用严格 Schema、`additionalProperties:false` 和领域校验；执行前做身份、资源、风险、额度和审批；执行时带 deadline、trace/idempotency key；执行后标准化结果、持久化审计并决定下一步。项目已实现主要链路。

6. **权限和副作用。** 最小权限 token、用户委托与服务身份分离、RBAC/ABAC、资源所有权、网络 allowlist、dry-run、逐调用审批、短期授权、幂等、事务/补偿和不可变审计。审批只能允许原本有权的操作，不能覆盖 RBAC；`toolPolicy.js` 正是这样设计。

## 三、稳定性、异常处理与故障治理——逐题回答

1. **死循环。** 同时设置图级 recursion/step limit、计划最大步数、相同 action 指纹重复阈值、无状态进展次数、Token/时间预算和人工接管。FSE-chatroom 的计划最多 8 步，执行图只遍历持久化 Todo，不允许模型在循环中无限追加任意工具。

2. **工具超时、失败、异常数据。** 传输错误与业务错误分开；输出也要 Schema 校验和大小限制。瞬态只读错误自动重试，参数/权限错误快速失败，未知写结果用幂等查询确认；耗尽预算后落失败状态，可重试或 handoff。项目已实现超时、只读 MCP 重试、失败持久化和人工接管。

3. **高并发 panic/内存泄漏。** Node.js 要监控 event-loop lag、heap/RSS、GC、句柄数和未处理 rejection；请求设大小/时间/并发上限，CPU/大对象工作进 Worker/队列；滚动重启只是止血，必须用 heap snapshot、负载剖析找根因。JSON Mock 不支持多进程并发，生产应换 MongoDB/外部状态。

4. **链路超时、重试、熔断、降级。** 从用户 deadline 反向分配 Planner、检索、工具预算；子调用不得超过剩余时间。重试只针对瞬态且保留总预算；熔断按 provider/tool/tenant 隔离；降级为缓存、只读摘要、小模型或人工，而不是静默返回假成功。

5. **断点续执行。** 在节点边界持久化 state 和下一步，外部副作用使用稳定幂等键；恢复时按 thread/run 找 checkpoint，并从失败/中断点继续，成功步骤不重放。当前执行图用 `workflow:userId:runId` thread、JSON Checkpointer 和 WorkflowStep 投影实现；生产需数据库 saver 与租约。

6. **无损发布。** API 无状态化；运行中的旧 workflow 由旧版本 worker drain；checkpoint/schema 做向后兼容和迁移；Prompt/Tool contract 版本随 Run 固化；先 canary/shadow，再扩大；失败可回滚代码但不能回滚已发生外部副作用。当前项目还没有部署编排，因此是设计建议。

7. **高可用。** 多副本 API、外部数据库/Checkpointer、队列化长任务、租约防双执行、幂等/outbox、依赖熔断、多区域是否需要由 RTO/RPO 决定。不要把本地 JSON checkpoint 当 HA。

8. **误删数据怎么防。** 模型不持有数据库自由查询权；删除工具用资源级权限、dry-run 预览、明确对象列表、二次审批、软删除/回收站、批量上限和延迟执行；关键数据需备份/PITR。高危批量操作最好根本不作为通用 Agent Tool。

9. **幂等机制。** 客户端/工作流生成稳定业务键，服务端用唯一索引或幂等记录原子占位，重复请求返回原结果；状态机用 compare-and-set 防重复迁移。项目 `post.publish` 以 `runId:stepId` 查重并处理唯一键冲突。

## 四、上下文工程与 Memory——逐题回答

1. **长对话不忘关键信息。** 除向量检索外还有滚动摘要、结构化事实表、任务状态、实体槽位、事件溯源、外部 artifact 引用、分层摘要和用户固定约束。项目组合了摘要 + 近期窗口 + 显式长期事实 + checkpoint。

2. **主流上下文工程。** 输入选择、历史裁剪、摘要、检索、Prompt 分层、工具 schema 裁剪、状态结构化、缓存、上下文隔离和冲突消解。策略应由 token 预算与任务风险驱动，并用消融实验验证每一块是否真的提升成功率。

3. **上下文膨胀。** 给 system/history/retrieval/tools/results 分配独立预算；旧消息摘要，工具大结果外置，工具定义按需加载，重复内容去重，超限时保留目标/约束/未完成事项而不是机械截尾。项目的 Memory Graph 在 token 或消息数越界时增量摘要。

4. **有限窗口保留长期任务。** State 只保存原始事实、当前计划、完成条件、产物 URI 和下一步；对话文本是辅助，不是真相源。阶段结束生成 checkpoint 和阶段摘要，需要细节时从外部存储重载。

5. **短期、长期、知识库分工。** 短期记忆属于当前 thread 的交互与执行状态；长期记忆属于用户跨 thread 的偏好/稳定事实；知识库属于组织可共享、可版本化的外部事实。三者的权限、更新者、TTL 和召回排序都不同，不能混成一个向量库。

6. **避免会话串扰。** 所有查询强制带 user/tenant/session namespace，服务端从 token 注入身份，客户端不能自报 userId；cache key、checkpoint thread、向量 metadata 和日志也必须带作用域。项目对 Session/Message/Run 和 memory thread 都组合用户与会话标识，并有所有权集成测试。

7. **Multi-Agent 共享什么。** 共享目标、硬约束、已验证事实、任务状态、artifact 引用和预算；按 need-to-know 共享，不共享密钥、无关用户记忆或隐藏推理。每条共享事实带来源、版本和信任级别，防止一个 Agent 的幻觉污染全局。

## 五、推理、规划与决策——逐题回答

1. **Tree of Thoughts 能在线上用吗。** 可以，但只适合高价值、可自动评分且分支很少的任务。限制 beam width/depth，用小模型生成候选、规则/critic 评分、缓存公共前缀；普通客服不值得。FSE-chatroom 采用单计划和确定性执行，更符合其低延迟与安全目标。

2. **“按老样子帮我订一下”。** 先检索已确认偏好和最近同类任务，但把日期、金额、对象等高风险字段列为必须确认；先生成预览，不直接下单。若“老样子”存在多个候选或记忆过期，主动澄清。

3. **防止信息不足时猜测。** 为 Tool Schema 标记必填字段，为业务定义 clarification policy；低风险默认值可明确展示，高风险字段禁止推断。Planner 应输出缺失槽位和问题，不输出伪造参数。

4. **规划、执行、反思、重规划。** 先生成带验收条件的短计划；逐步执行并把结果写成 observation；只在失败、事实变化或验收不通过时局部 replan；反思必须输出可验证的差异，不保存自由推理长文。项目当前只对天气结果做受限后续决策，不是通用 replan。

5. **最大步数、Token Budget 和停止条件。** 按任务等级配置硬上限，并把剩余预算放进 state。停止条件包括目标完成、明确失败、需要用户、无进展、重复 action、超步数、超 Token/时间/金额、策略拒绝。项目已有 8 步协议上限和多类终态，尚缺全链路金额预算。

6. **防循环和无效推理。** 对 `(state digest, action, arguments)` 做重复检测；每一步必须声明预期状态变化；连续 N 步无新事实则终止；只允许白名单图边；工具错误不要原样无限回灌。把规划和执行 Trace 纳入测试，检查最短可行路径。

## 六、Agent 评测与可观测性——逐题回答

1. **除了准确率还有什么。** 任务成功率、工具选择/参数准确率、计划效率、事实一致性、安全违规率、恢复成功率、人工接管率、延迟、Token、成本、可用性和用户满意度。不同任务要分层统计，不能把简单 FAQ 稀释复杂任务失败。

2. **任务完成率。** `满足完成定义的终态任务数 / 可评估终态任务数`；取消、等待审批、超时要单列，不应随意算失败或成功。用确定性业务断言优先于 LLM judge，例如帖子是否真的只发布一次。

3. **工具调用准确率。** 分成工具选择 precision/recall、参数字段准确率、Schema 通过率、调用时机正确率和副作用正确率。为每条 golden case 标注期望 action/arguments/risk decision，并允许等价计划集合。

4. **规划与执行质量。** 规划看可执行性、约束覆盖、依赖顺序、冗余步数和风险识别；执行看成功率、重试放大、幂等、恢复和最终业务状态。两者分开，避免把 provider 宕机误判成 Planner 差。

5. **幻觉率和事实一致性。** 把回答拆成 atomic claims，对可验证 claim 做来源支持率、矛盾率和引用正确率；动作场景再看参数是否来自已验证事实。LLM judge 可扩展覆盖，但要用人工校准集监控 judge 偏差。

6. **端到端延迟。** 在同一 workload 和并发下记录 Planning、Memory/Retrieval、Tool、排队、人工等待和总耗时的 histogram，再算 P50/P95/P99。人工等待应单列，否则审批任务会把服务性能指标污染。当前项目评测已输出 Planning 和自动执行端到端分位数。

7. **Token 与单任务成本。** 持久化供应商 usage，按模型价格版本换算 input/cache/output/reasoning token，并加工具、检索和基础设施成本。报告 `cost/successful task` 比 `cost/request` 更有业务意义。当前项目已有 Token 汇总，没有价格表。

8. **线上观测指标体系。** RED（Rate/Error/Duration）+ 资源饱和度 + Agent 指标（成功、步骤、重试、HITL、Token、安全拒绝）+ 业务指标（真实完成/转人工/用户纠错）。按模型、Prompt、工具、租户和版本切片，但限制高基数标签。

9. **Trace 设计。** 根 span 是 `invoke_agent/workflow`；子 span 为 memory/retrieval、chat、policy、execute_tool、checkpoint；状态变化用 event。记录 ID、版本、耗时、usage、错误码和参数摘要，不默认记录完整内容。OpenTelemetry 的 GenAI 语义约定仍在演进，应锁定版本并提供迁移开关。

## 七、性能优化、模型调度与成本控制——逐题回答

1. **降低 P95。** 先用 Trace 找尾延迟来源，再减少串行关键路径：并行独立检索/工具、连接池、流式首 token、缓存、超时/熔断、排队隔离和慢依赖降级。只优化平均值通常救不了 P95。

2. **向量检索性能。** 选择适当 ANN 索引和参数，metadata 预过滤，批量 embedding，冷热分层，减少维度/量化，缓存热门 query，并用 Recall@K 对照延迟调参。不能只追求 QPS 导致召回崩溃。

3. **资源瞬时打满。** 接入层限流，租户级 semaphore，队列削峰，worker autoscaling，Token/并发配额，长短任务隔离和 load shedding。项目目前只有 API rate limit，不足以应对模型/工具并发洪峰。

4. **缓存架构。** 分为 Prompt prefix/provider cache、检索缓存、工具结果缓存、会话投影缓存和最终回答语义缓存。Key 必须包含 tenant、权限、模型/Prompt/索引版本；副作用和强时效数据默认不缓存。采用 stale-while-revalidate 也要明确陈旧容忍度。

5. **降低 Token 成本。** 工具定义按需加载，历史摘要，检索去重，结构化短结果，限制输出，简单任务小模型，失败快速终止。先消除重复上下文，再谈压缩 Prompt 文案。

6. **大小模型平衡。** 小模型做意图、抽取、分类和格式修复；大模型处理复杂规划、跨文档推理和低置信升级。路由器看任务特征和小模型置信，不只看用户等级。

7. **多模型路由。** 维护 capability/质量/延迟/成本矩阵，策略输入包含任务类型、风险、上下文长度、语言、SLO 和 provider health；支持 fallback、shadow、canary 和 sticky version。评测集必须按路由分桶，避免辛普森悖论。

8. **哪些走小模型。** 短、结构化、低风险、单工具、可规则校验的请求优先小模型；长上下文、多约束规划、模糊意图、高价值生成或小模型低置信时升级。高风险不一定用大模型解决，往往应增加规则和人工审批。

## 八、RAG、Elasticsearch 与检索——逐题回答

> 本节均为**设计建议**；当前项目没有 Elasticsearch 或知识库 RAG。

1. **Elasticsearch 的作用与优化。** 它适合 BM25、字段过滤、权限过滤、聚合、稀疏/稠密向量和 hybrid retrieval。优化从 mapping/analyzer、分片规模、filter cache、`track_total_hits`、候选窗口、refresh 策略和慢查询入手，并用相关性指标约束性能优化。

2. **ES 与向量数据库。** ES 擅长词法、结构化过滤和一体化 hybrid；专用向量库可能在超大规模 ANN、向量生命周期或特定索引上更专注。不是必须双存：先根据规模、过滤复杂度、运维能力和一致性成本选择一个主检索系统。

3. **Hybrid Search。** 并行执行 BM25 与 dense/sparse retrieval，经权限过滤后用 RRF 合并，再对 Top-N rerank。RRF 不要求归一化异构分数，适合作为无标注数据时的起点；有充分标注再尝试线性权重/LTR。

4. **召回、重排、生成优化。** 召回追覆盖率和权限正确；重排追 nDCG/MRR 与延迟；生成追证据忠实、引用和拒答。逐层做消融，不能看到最终答案错就直接换大模型。

5. **评估召回与回答。** 召回用 Recall@K、MRR、nDCG、权限泄露率；回答用 correctness、faithfulness、citation precision/recall、拒答正确率和人工偏好。评测集要包含时效、否定、版本冲突和无答案问题。

6. **降低向量延迟。** metadata 预过滤、ANN 参数调节、量化、分片路由、批处理、连接复用、embedding/query cache、候选数分级和热点预热；同时监控 Recall 损失。

7. **Chunk/Overlap/Top-K。** 从结构化切分和领域文档分布出发，通过网格实验选择；Top-K 要与 rerank 和上下文预算联调。没有统一最佳值，面试中给固定“500 字、Top-5”却没有评测依据是不可靠的。

## 九、Kafka 与异步任务——逐题回答

> 当前项目没有 Kafka；以下是长任务规模化后的方案。

1. **Kafka 场景与顺序。** 可承载 workflow command、tool result、审计事件、异步记忆和评测。Kafka 只保证 partition 内顺序，因此按 `sessionId` 或 `runId` 作为 key；需要全局顺序只能单 partition，会牺牲并行度。

2. **异步任务堆积与消费。** 按任务类型/优先级分 topic 或队列，监控 lag、oldest age、处理时长和失败率；消费者设并发/租户配额，autoscale 但保护下游。超过 SLA 的任务可过期、降级或转人工，不能无限堆积。

3. **重复消费。** 默认按 at-least-once 设计：消息带 event/task id，消费端用 inbox/唯一键去重，业务写入和消费位点协调；外部副作用仍需幂等键。不要仅靠“提交 offset”宣称 exactly-once。

4. **重试与死信。** 短暂错误进入带退避的 retry topic，次数/总时限耗尽进入 DLQ；DLQ 保存错误分类、原消息引用和重放审计。参数/权限错误不应重试。

5. **同会话/任务顺序。** 用一致 key 固定到同一 partition，同一 consumer group 内一个 partition 同时只给一个 consumer；消费端再用 state version/CAS 防乱序旧消息覆盖新状态。

6. **为什么不用全同步 RPC。** 长任务会占连接、放大级联超时并难以削峰。队列提供持久化、背压、重放、解耦和独立伸缩；用户用 task id 查询/订阅进度。短、低延迟、必须立即返回的操作仍适合同步 RPC。

## 十、Redis——逐题回答

> 当前项目没有 Redis；JSON Mock 明确不适合生产并发。

1. **长文/拼团平台 Redis 用途。** 若真实项目采用，可用于会话/热点内容缓存、拼团库存计数、限流、延迟任务和短租约；但必须提供代码与指标。本项目不能声称这些已使用。

2. **Redis + MySQL 最终一致。** 以数据库为事实源，事务提交后通过 outbox/CDC 失效或更新缓存；读路径用 cache-aside。避免“先写缓存再写 DB”的双写窗口，关键状态不要只在缓存。

3. **分布式锁方案。** 本项目只有进程内 thread lock，不是 Redis 锁。若上 Redis，至少 `SET key token NX PX ttl`，释放时 compare-and-delete，长任务续租，并为关键写加入 fencing token。

4. **SET NX 与 Redisson。** 单独 `SETNX` 若无 TTL 会死锁，错误 `DEL` 会删别人锁，暂停超过租期会出现双持有。成熟库提供原子释放、续租、重入/公平等能力，但也不能替代 fencing 和业务幂等；Redisson 是 Java 方案，不适用于当前 Node 项目。

5. **ZSet 底层。** 典型实现组合哈希表与跳表：哈希按 member 快速找 score，跳表按 score 有序范围查询；小集合内部编码会随 Redis 版本/配置变化，回答时不应死背单一实现细节。

6. **跳表复杂度。** 平均查询/插入/删除 `O(log N)`，范围遍历 `O(log N + M)`；结构简单、范围扫描自然，适合排行榜和延迟队列。

7. **Agent 中 Redis 场景。** 短期会话缓存、速率/并发限制、provider 熔断状态、任务 lease、幂等短记录、语义缓存和队列。持久 workflow 真相源不应只依赖易失缓存。

8. **会话、缓存、限流和锁。** 会话 key 必须含 tenant/user/session；缓存带版本与 TTL；限流可用 Lua/token bucket；锁带唯一 token、TTL、原子释放和 fencing。每类 key 设置容量、淘汰和隐私策略。

## 十一、MySQL 与数据库——逐题回答

> 当前项目生产模型是 MongoDB/Mongoose，并非 MySQL；下述为数据库通用设计与 MySQL 知识。

1. **脏读与幻读。** 脏读是读到未提交数据；幻读是同一范围查询在事务内出现/消失行。InnoDB 默认 Repeatable Read 通过 MVCC 和 next-key lock 处理多数场景；隔离级别越高并发代价通常越大。

2. **B 树与 B+ 树。** B 树内部节点也存记录；B+ 树数据集中在叶子，内部节点只做索引，扇出更高，叶子链表利于范围扫描。

3. **为什么 MySQL 用 B+ 树而非跳表。** 磁盘/页存储重视高扇出、少 I/O、稳定页布局和范围扫描；B+ 树契合这些需求。Redis 以内存为主，跳表的指针和随机层级成本可接受且实现灵活。

4. **Redis + MySQL 最终一致。** 同第十节第 2 题：DB 事务 + outbox/CDC + cache invalidation，配合重试和对账。强一致关键流程直接读主库，不赌缓存同步时序。

5. **Agent 数据库写事务。** 模型只提交领域 command，应用服务在事务内检查权限、状态版本和约束，再写业务表与 outbox；外部 API 不放在长数据库事务里。使用幂等键和乐观锁防重复/并发覆盖。

6. **错误操作回滚。** 数据库内用事务回滚；跨系统用 Saga 补偿，不承诺物理回滚一切；删除优先软删/PITR，资金使用冲正。补偿本身也要幂等、审批和审计。

## 十二、并发、任务隔离与平台工程——逐题回答

1. **会话隔离。** 身份从 JWT 获取，所有存储查询带 user/tenant，checkpoint/cache/vector namespace 同样隔离；禁止客户端传 userId 决定访问域。项目已实现 user/session 双重隔离。

2. **异步任务堆积。** 有界队列、优先级、租户公平、lag/age 告警、autoscaling、过期策略、DLQ 和人工取消。入口需背压，而不是接受无限任务后再排队。

3. **并发上限和资源配额。** 全局、租户、用户、模型、工具五级 semaphore/token bucket；配额包含并发、RPM、TPM、日成本和存储。关键客户也不能绕过下游安全容量。

4. **多租户隔离。** 数据行/库、缓存 key、向量 namespace、密钥、队列、审计和配额都带 tenant；企业级可进一步独立数据库/网络/加密键。当前项目只有用户级隔离，不应称完整多租户平台。

5. **避免单任务耗尽资源。** 限制输入/输出、步骤、工具结果大小、内存、CPU、并发、deadline 和子任务扇出；超限可 checkpoint 后暂停或终止。外部文件/大结果只存引用。

6. **Worker Pool。** 按任务类型和资源特征建 pool，worker 从租约队列拉取，周期续租，崩溃后可再投递；每任务带 deadline/idempotency/version。CPU、网络、GPU 任务不要混用同一并发参数。

7. **长短任务竞争。** 独立队列/worker、优先级加 aging、预留容量、每租户权重和长任务可抢占 checkpoint。仅用 FIFO 会让短请求被长任务头阻塞。

## 十三、团队协作与技术决策——逐题回答

1. **推动技术选型与演进。** 从业务失败模式和指标出发，写 ADR，做最小 PoC/Benchmark，明确退出条件，再渐进替换。FSE-chatroom 适合先证明单 Agent 的安全闭环，而不是为趋势先上 Multi-Agent。

2. **方案分歧。** 先把争论转成假设、约束和可测指标；列安全、复杂度、成本和迁移风险；小实验决定可验证问题，剩余价值判断由责任人记录。结论和反对意见写入 ADR，便于复盘。

3. **PoC、Benchmark、线上指标。** PoC 验证能不能做，Benchmark 验证在固定 workload 下是否更好，线上 canary 验证真实分布与运维成本。模型选择至少比较质量、P95、Token、失败率和安全案例，而非只看几条 Demo。

4. **快迭代不牺牲稳定。** 契约测试、feature flag、Prompt/模型版本、shadow/canary、自动回归、回滚、错误预算和高风险审批。把实验流量与生产写工具隔离。

5. **模型层、平台层、业务层。** 模型层负责推理/embedding及其评测；平台层负责网关、编排、状态、工具、策略、观测和成本；业务层负责领域规则、数据权限、完成定义和赔偿/合规。权限判断必须属于业务/平台代码，不属于 Prompt。

## 十四、技术趋势与开放题——逐题回答

1. **发展方向与工程落地。** 最容易落地的是受限 Copilot、检索/总结、单域工具流、审批式自动化和后台长任务。2026 的明显方向是 durable execution、context engineering、eval-driven development、模型路由，以及 MCP/A2A 的协议化互操作；完全开放自主 Agent 仍不适合高风险默认执行。

2. **当下能力怎么看。** 模型在语言理解、代码、工具选择和局部规划上很强，但长程一致性、隐含约束、异常恢复和真实世界权限仍不稳定。正确定位是“概率控制器 + 确定性外壳”，不是替代事务系统。

3. **最大挑战。** 可验证性和责任边界：系统是否知道自己缺信息、动作是否授权、失败能否恢复、结果能否证明。解决靠评测集、结构化状态、最小权限、幂等、审计和人工升级，不是单纯换更大模型。

4. **未来规划。** 对本项目，优先级应是数据库 checkpointer/lease/outbox、OTel、离线 golden set、租户预算和 provider 路由；知识库确有需求再加 hybrid RAG；跨团队独立 Agent 出现后再评估 A2A。避免技术倒置。

5. **近期技术/论文。** 可关注 MCP `2026-07-28` 的无状态与 Tasks 扩展、A2A 1.0、OpenTelemetry GenAI 语义约定、Agentic AI 安全威胁、长任务评测和可验证执行。回答面试时应说清“读了什么、做了什么实验、改变了什么设计”，而不只报论文名。

6. **如何系统学习新技术。** 先读规范/论文和官方最小示例，建立心智模型；实现一个可失败的 PoC；设计基线与反例；读源码关键路径；做压测/故障注入；写 ADR 和复盘；最后才封装成团队模板。FSE-chatroom 的策略、记忆和 checkpoint 测试可作为这一过程的实际例子。

7. **Demo 到生产的鸿沟。** Demo 展示 happy path，生产面对权限、并发、超时、重放、成本、漂移、隐私和事故。跨越方式不是增加更多 Agent，而是把完成定义、状态、策略、评测、观测、恢复和发布治理补齐。

## 参考资料（官方/一手来源）

- [MCP 2026-07-28 规范发布说明](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [A2A Protocol v1.0 规范](https://a2a-protocol.org/latest/specification/)
- [LangGraph：Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)
- [OpenTelemetry GenAI 语义属性](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
- [Elastic Hybrid Search 与 RRF](https://www.elastic.co/docs/solutions/search/hybrid-search)
- [Apache Kafka 4.2 Streams exactly-once 配置](https://kafka.apache.org/42/streams/developer-guide/config-streams/)
- [Redis 分布式锁说明](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- [MySQL InnoDB Locking and Transaction Model](https://dev.mysql.com/doc/refman/26.7/en/innodb-locking-transaction-model.html)
- [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/download/52117/)
