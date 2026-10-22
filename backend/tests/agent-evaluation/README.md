# Agent evaluation suite

This folder is the reproducible Agent-quality layer. Existing integration and
unit suites remain the release gate; this suite measures whether the planner
chooses the right behavior and whether persisted tool traces are auditable.

## Commands

Run deterministic metric and trace-audit tests (zero LLM calls):

```bash
npm run test:agent-eval
```

Run the fixed live planner set (at most seven LLM calls by default):

```bash
npm run eval:agent
```

`AGENT_EVAL_MAX_CASES=3 npm run eval:agent` lowers the call budget. The runner
loads `backend/.env`, never writes the API URL/key, makes no judge-model calls,
and stores the latest report at `results/live-latest.json`.
`thresholds.json` is the explicit regression budget; a breached quality,
latency, safety, or total-token threshold makes the live command fail.

## What is measured

| Layer | Metrics / checks | Method |
| --- | --- | --- |
| Planner routing | intent accuracy, coverage accuracy | Exact expected label |
| Tool choice | precision, recall, F1, ordered-tool accuracy, unnecessary calls | Exact action IDs; no subjective judge |
| Arguments | argument exact match | Deep equality against fixed arguments |
| Safety | RBAC denial, conversation-without-tools, write approval requirement, prompt-injection resistance | Server-validated plan fields |
| Multi-stage behavior | weather query only before conditional publish | Exact tool sequence plus `weatherAlert` flag |
| Efficiency | latency average/p50/p95, total and average tokens | Provider usage and wall-clock time |
| Tool reliability | success rate, duration p95, errors by type/action | Persisted `ToolCall` records |
| Trace integrity | run/step/call correlation, input/action parity, lifecycle events, failure classification | `auditWorkflowTrace` invariants |
| Side-effect safety | bound per-tool approval, rejected-step non-dispatch, duplicate write detection | Approval and call linkage |

The exact-match pass criterion is deliberately strict. It makes regressions
easy to explain, while precision/recall/F1 still show partial tool-selection
quality. Free-form reply style is not scored: adding an LLM-as-judge would add
cost, variance and self-preference bias. If reply quality becomes a product
requirement, use a separately versioned rubric, blind human labels, and judge
model calibration against those labels.

## Existing coverage outside this folder

- Unit: action/schema synchronization, JSON protocol validation, RBAC,
  approval grants, prompt streaming, MCP adaptation/retry, idempotent publish,
  human interrupt/resume/reject, and aggregate operational metrics.
- Integration: HTTP authentication/RBAC, sockets, persisted workflow graph,
  approval/execution/retry and SSE contracts.
- Context: memory persistence, bounded compaction, deterministic factual recall
  and compression ratio.
- Performance: API and socket throughput, p50/p95/p99 latency and delivery rate.

Those tests validate code paths but do not estimate real-model task quality.
The live cases in this directory close the first part of that gap.

## Gaps to explain honestly in an interview

This is a small smoke benchmark, not a production claim. Before presenting a
model as production-ready, add:

1. A versioned 50–200 case dataset sampled from real, anonymized traffic, with
   train/eval separation and per-capability slices.
2. Multi-turn goal completion and execution-result correctness, including tool
   output grounding; the current live suite mainly scores planning.
3. Adversarial suites for indirect prompt injection in tool output, secret/PII
   leakage, data exfiltration, confused-deputy attacks and argument mutation.
4. Fault injection for provider timeout/rate limit, malformed output, MCP
   partial failure, crash-after-side-effect, concurrent retry and checkpoint
   recovery.
5. Model/version and prompt A/B comparison with confidence intervals, repeated
   runs for nondeterminism, cost per successful task and quality/latency/cost
   regression budgets.
6. Production dashboards and alerts over the same trace invariants, plus
   retention/redaction policy. A test-time auditor is not continuous monitoring.

For an interview, describe three distinct layers: deterministic CI protects
contracts and safety boundaries; the fixed live benchmark detects model/prompt
quality regressions; production telemetry measures real task outcomes and
drives dataset refresh. Do not combine “rejected/failed” with actual human
takeover, and do not claim business task success from HTTP 200 or tool success
alone.
