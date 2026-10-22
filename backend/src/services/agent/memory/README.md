# Agent memory

This module keeps prompt memory separate from the durable chat/audit log.

- `AgentMessage` remains the source of truth for UI and audit history.
- The JSON Checkpointer persists the complete thread state, including a rolling
  summary and a token-bounded recent-message window.
- `AgentMemory(kind=long_term)` stores only facts the user explicitly asked the
  agent to remember. Retrieval is lexical while the local JSON database is in
  use.
- `graph.js` owns the LangGraph memory lifecycle: hydrate, decide whether to
  compact, compact incrementally, and assemble prompt context.
- `checkpointer.js` provides an atomic JSON-backed mock LangGraph Checkpointer
  and serializes runs for the same thread.
- A compaction rewrites the existing summary and newly archived turns with one
  OpenAI-compatible LLM call. `AGENT_MEMORY_SUMMARY_TOKENS` bounds generated
  tokens (default: 800); `AGENT_MEMORY_SUMMARY_TIMEOUT_MS` bounds latency. If
  the provider is unavailable, the projection uses a deterministic fallback.
- `index.js` is the application facade and serializes turns per session because
  the JSON mock store has no transactions or compare-and-swap operation.

The first access to a legacy session bootstraps this projection from
`AgentMessage`; normal turns never scan the complete message collection.

For a multi-instance production deployment, replace the mock checkpointer with
an official persistent database saver and replace its process-local lock with a
database lease or optimistic concurrency. The facade and graph state contract
should remain unchanged.
