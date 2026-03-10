# Changelog

## v0.1.0 — 2026-03-10

Initial release.

### Features

- 3 attack agents: Boundary Walker, Mutant Breeder, Type Shapeshifter
- 3 oracle layers: Status/Input Validation, Self-Consistency, Response Schema
- OpenAPI 3.x and Swagger 2.x spec support
- Auto-detect spec when `--spec` is omitted (probes 14 common paths)
- Auth detection — exits early with hint when all endpoints return 401/403
- Composed schema support: allOf (merge), oneOf/anyOf (first variant)
- Circular `$ref` depth guard (MAX_DEPTH=10)
- Consistency checker: create-read and delete-verify flows
- Deduplication via fingerprint hashing
- Persistent bug tracking across runs (~/.havoc/history.db)
- Every bug includes a paste-able `curl` reproduce command
- `--fail-on` flag for CI integration (exit code 1 on severity threshold)
- Output formats: terminal, JSON
