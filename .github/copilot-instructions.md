# Trendsetter Workspace Instructions

- This workspace is a TypeScript monorepo with a WebExtensions browser extension in `apps/extension`, a Fastify SQLite API/RAG server in `apps/server`, and shared contracts in `packages/shared`.
- Keep browser collection compliant and best-effort: do not bypass logins, paywalls, anti-abuse systems, or platform access controls. Prefer official APIs for production-grade completeness.
- Keep storage abstractions replaceable. SQLite is the first datastore, but repositories should not leak SQL details into route or RAG orchestration code.
- Keep embedding, vector-store, reranker, and answer-generation providers behind interfaces so better models or Postgres/vector databases can be swapped in later.
- Use `npm run build`, `npm run check`, and targeted workspace scripts for verification.