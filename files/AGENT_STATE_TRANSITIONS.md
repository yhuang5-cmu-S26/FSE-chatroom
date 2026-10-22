# Agent 状态转移

## 1. Workflow（持久化业务状态）

### 1.1 WorkflowRun

```mermaid
stateDiagram-v2
    [*] --> awaiting_approval: 可执行命令计划
    [*] --> rejected: 计划不可覆盖
    awaiting_approval --> running: 批准计划
    awaiting_approval --> handed_off: 人工接管
    running --> awaiting_input: 工具需单步审批
    running --> succeeded: 全部步骤成功
    running --> failed: 步骤执行失败
    running --> rejected: 策略拒绝/审批拒绝或过期
    running --> awaiting_approval: 天气结果生成发帖步骤
    running --> handed_off: 人工接管
    awaiting_input --> running: 批准或编辑后批准
    awaiting_input --> rejected: 拒绝/审批过期
    awaiting_input --> handed_off: 人工接管
    failed --> running: 重试
    failed --> handed_off: 人工接管
    rejected --> handed_off: 人工接管
    succeeded --> [*]
    rejected --> [*]
    handed_off --> [*]
```

> `handed_off` 在路由实现中仅禁止从消息状态 `executed` 进入；因此除成功完成外的命令 Run 均可能被人工接管。

### 1.2 WorkflowStep

```mermaid
stateDiagram-v2
    [*] --> planned: 创建计划步骤/条件发帖步骤
    planned --> running: 工具开始执行
    planned --> rejected: 策略拒绝/审批拒绝或过期
    running --> succeeded: 工具成功
    running --> failed: 工具失败
    failed --> running: Run 重试该步骤
    succeeded --> [*]
    rejected --> [*]
```

`skipped` 已在模型枚举中声明，但当前实现没有写入该状态。

### 1.3 ToolCall

```mermaid
stateDiagram-v2
    [*] --> running: startStep
    running --> succeeded: 工具成功
    running --> failed: 工具失败
```

## 2. Agent（图流程与消息投影）

### 2.1 子图区域：Memory Graph

```mermaid
flowchart LR
    subgraph MEMORY[Memory 子图]
        MS([START]) --> MH[hydrate]
        MH -->|超出 token/消息阈值或强制压缩| MC[compact]
        MH -->|无需压缩| MB[build]
        MC --> MB
        MB --> ME([END])
    end
```

### 2.2 子图区域：Planning Graph

```mermaid
flowchart LR
    subgraph PLANNING[Planning 子图]
        PS([START]) --> P[plan]
        P -->|intent = conversation| C[conversation]
        P -->|command 且 canCover| CMD[command]
        P -->|command 且不可覆盖| R[rejected]
        C --> PE([END])
        CMD --> PE
        R --> PE
    end
```

规划结果对应的 `AgentMessage.planner.approvalStatus`：

| 规划结果     | 状态           |
| ------------ | -------------- |
| 对话         | `not_required` |
| 可执行命令   | `pending`      |
| 不可覆盖命令 | `rejected`     |

### 2.3 子图区域：Execution Graph

```mermaid
flowchart LR
    subgraph EXECUTION[Execution 子图]
        ES([START]) --> X[execute_step]
        X -->|仍有步骤，且无失败/后续审批| X
        X -->|完成、失败、拒绝或需后续审批| F[finalize]
        F --> EE([END])
        X -. 工具需审批 .-> I[[interrupt / checkpoint]]
        I -. Command resume .-> X
    end
```

消息投影状态转移：

```mermaid
stateDiagram-v2
    pending --> approved: 批准计划
    approved --> awaiting_input: 工具触发 interrupt
    awaiting_input --> approved: 批准/编辑后恢复
    awaiting_input --> rejected: 拒绝/审批过期
    approved --> executed: 全部步骤成功
    approved --> failed: 步骤失败
    approved --> rejected: 策略拒绝
    approved --> pending: 生成条件发帖步骤
    pending --> handed_off: 人工接管
    failed --> approved: 重试
```

人工接管时，仅 `pending --> handed_off` 会同步消息投影；其他非 `executed` 状态可将 Run 转为 `handed_off`，但消息投影保持原值。

### 2.4 AgentSession

```mermaid
stateDiagram-v2
    [*] --> active: 创建会话
```

`archived` 已在模型枚举中声明，但当前实现没有状态转移；删除会话是记录删除，不是状态转换。

## 3. 幂等边界

- 必须幂等：`post.publish` 等有外部副作用的写工具。
- 当前键：`runId:stepId`；帖子表以 `agentIdempotencyKey` 唯一索引去重。
- 当前缺口：检查点、Run/Step/Approval/Event 的多次落库与外部副作用不在同一事务中；除发帖外的新写工具也必须显式实现该键。
