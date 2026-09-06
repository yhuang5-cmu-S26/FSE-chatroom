# Backend tests

All commands below run from `backend/`. Integration tests temporarily bind a local random port; they do not use a real MongoDB or LLM endpoint.

| Command | Scope | Purpose |
| --- | --- | --- |
| `npm test` | integration + unit | Authentication, RBAC, sockets, Agent contracts, approval and execution |
| `npm run test:context` | context | Context compression ratio and deterministic factual-answer parity |
| `npm run test:performance` | performance | Benchmark baseline and current service paths |
| `npm run verify` | verification | Produce the verification report under `tests/reports/` |

## Agent Observability / Eval

`GET /api/agent/evals/summary` is admin-only and aggregates persisted command plans. It reports task success rate (executed / terminal plans), tool success rate (executed / attempted steps), explicit human takeover rate, intervention-required rate, average planned steps, average end-to-end time, and grouped error types.

An explicit takeover is recorded through `POST /api/agent/sessions/:sessionId/handoff`; a rejected or failed plan is tracked separately as **intervention required**, because it does not prove a person actually took over. The deterministic aggregation coverage lives in `tests/unit/agentEvaluation.test.js`.

## Context-compression evaluation

`tests/context/historyCompression.test.js` compares the raw-history and compressed-history inputs using a deterministic answer oracle. It asserts both a minimum compression rate and identical answers for preserved facts. This is a regression test, not an LLM quality benchmark.

The fixture currently yields a 65% character reduction while preserving the expected answer. Tune `AGENT_CONTEXT_RECENT_MESSAGES` and `AGENT_CONTEXT_SUMMARY_CHARS` in the backend environment to trade prompt cost for raw-turn fidelity.

For a production-quality semantic evaluation, pin a model version and run the same fact set through the deployed planner, then record task success, factual recall, latency, and input/output tokens. Keep those provider-dependent evaluations separate from this deterministic CI suite.
