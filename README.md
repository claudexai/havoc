# Havoc ⚔️

**Multi-agent adversarial API testing. Find bugs your test suite misses.**

3 agents. 3 oracle layers. 200+ requests. Every bug comes with a paste-able `curl` command.

```bash
npx havoc run --spec https://example.schemathesis.io/openapi.json --url https://example.schemathesis.io
```

```
⚔️  HAVOC — Multi-Agent API Adversarial Testing Engine

[4/6] ATTACK — Agents engaging...
  [Boundary Walker] Done — 255 requests, 12 bugs found
  [Mutant Breeder] Done — 394 requests, 12 bugs found
  [Type Shapeshifter] Done — 180 requests, 8 bugs found

  Oracle layers:
    Layer 1: Status/Input Validation — 18 bugs
    Layer 2: Self-Consistency — 2 bugs
    Layer 3: Response Schema — 4 bugs

[6/6] REPORT
  ════════════════════════════════════════════════
  6 critical | 14 high | 4 medium
  ════════════════════════════════════════════════

  [CRITICAL] Server error
  POST /improper-unicode-encoding returned 500 (null field: text)
  Reproduce:
  curl -X POST \
    'https://example.schemathesis.io/internal-server-errors/improper-unicode-encoding' \
    -H 'Content-Type: application/json' \
    -d '{"text":null}'
```

Tested against Schemathesis's own demo API. Found 24 bugs in 70 seconds.

---

## Why Havoc?

Most API fuzzers use **one strategy** and only catch **crashes** (500 errors).

Havoc uses **3 competing agents** with **3 oracle layers** that catch crashes, wrong data, and schema violations — all from your OpenAPI spec, zero config.

| | Havoc | Schemathesis | RESTler |
|---|---|---|---|
| Multi-strategy agents | ✅ 3 | ❌ Single | ❌ Single |
| Catches wrong data (not just crashes) | ✅ Self-consistency | ❌ | ❌ |
| Response schema validation | ✅ Deep body check | ✅ Basic | ❌ |
| Bug tracking across runs | ✅ SQLite + regression detection | ❌ | ❌ |
| CI-ready (--fail-on) | ✅ | ❌ | ❌ |
| Curl command per bug | ✅ | ✅ | ❌ |

---

## Quick Start

```bash
# Any API with an OpenAPI spec
npx havoc run --spec ./openapi.yaml --url http://localhost:3000

# Remote spec
npx havoc run \
  --spec https://petstore3.swagger.io/api/v3/openapi.json \
  --url https://petstore3.swagger.io/api/v3

# With auth
npx havoc run --spec ./api.yaml --url http://localhost:3000 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Only run specific agents
npx havoc run --spec ./api.yaml --url http://localhost:3000 \
  --agents boundary_walker,type_shapeshifter

# CI mode — exit code 1 if new bugs found
npx havoc run --spec ./api.yaml --url http://localhost:3000 \
  --fail-on new_bugs
```

---

## How It Works

```
                    ┌──────────────┐
                    │ OpenAPI Spec │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   DISCOVER   │  Parse spec → universal model
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │     SEED     │  Generate valid requests
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   BASELINE   │  Record normal behavior
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Boundary │ │  Mutant  │ │   Type   │
        │  Walker  │ │ Breeder  │ │Shapeshiftr│  3 agents in parallel
        └────┬─────┘ └────┬─────┘ └────┬─────┘
              │            │            │
              └────────────┼────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Oracle 1 │ │ Oracle 2 │ │ Oracle 3 │  3 validation layers
        │  Status  │ │ Consist. │ │  Schema  │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼───────┐
                    │    REPORT    │  Bugs + curl commands
                    └──────────────┘
```

---

## The 3 Agents

### Boundary Walker — VALUE limits

Reads spec constraints and tests at every edge.

```
Spec: { "price": number, minimum: 0, maximum: 999999 }

Sends: 0, -1, 999999, 1000000, MAX_SAFE_INTEGER, null, empty
Also: removes required fields, empty strings at maxLength, invalid enums
```

### Mutant Breeder — STRUCTURE attacks

Takes valid requests and breaks them in targeted ways.

```
Valid: { "name": "Widget", "price": 9.99 }

Sends:
  { "price": 9.99 }                          ← removed field
  { ...valid, "is_admin": true }              ← privilege escalation
  { ...valid, "price_override": 0.01 }        ← business logic bypass
  { ...valid, "__proto__": { "admin": true }}  ← prototype pollution
  { "name": "Widget'" }                       ← SQL injection probe
  { "name": "Widget<script>" }                ← XSS probe
```

### Type Shapeshifter — TYPE confusion

Sends correct structure but wrong types. Catches silent coercion bugs.

```
Spec: { "quantity": integer }

Sends:
  { "quantity": "2" }       ← string (JS silently coerces)
  { "quantity": 2.7 }       ← float (2.7 items?)
  { "quantity": true }      ← boolean (becomes 1)
  { "quantity": [2] }       ← array (JS coerces to number)
  50-level deep nesting     ← stack overflow / DoS
```

---

## The 3 Oracle Layers

### Layer 1: Status Code Validation

```
500 on any input                      → CRITICAL (server crashed)
200 on invalid input (missing field)  → HIGH (validation missing)
400 on valid input                    → HIGH (broken validation)
```

### Layer 2: Self-Consistency

Uses the API against itself. No need to know the "correct" answer.

```
POST /products { price: 9.99 } → 201 { id: "42" }
GET  /products/42              → 200 { price: 14.99 }
BUG: Created with 9.99, read back 14.99

DELETE /products/42 → 204
GET    /products/42 → 200 (still there!)
BUG: Deleted but not actually removed
```

### Layer 3: Response Schema Validation

Deep body validation against the spec.

```
Spec:     { id: string, status: enum[pending,shipped], total: number(required) }
Response: { id: 12345, status: "PENDING", items: [] }

Catches:
  "id" expected string, got number
  "status" not in enum [pending, shipped]
  "total" required field missing
```

---

## Bug Tracking

Every bug gets a deterministic fingerprint. Tracked across runs in SQLite.

```
Run 1 (Monday):    5 bugs → all NEW
Run 2 (Tuesday):   3 bugs → 3 known, 2 fixed ✅
Run 3 (Wednesday): 4 bugs → 3 known, 1 REGRESSION ⚠️
```

CI integration:

```bash
npx havoc run --spec ./api.yaml --url http://localhost:3000 --fail-on new_bugs      # block PRs with new bugs
npx havoc run --spec ./api.yaml --url http://localhost:3000 --fail-on regressions   # catch regressions
npx havoc run --spec ./api.yaml --url http://localhost:3000 --fail-on critical      # only block on 500s
```

---

## Features

- 3 agents attacking in parallel (Boundary Walker, Mutant Breeder, Type Shapeshifter)
- 3 oracle layers (status validation, self-consistency, response schema)
- Bug tracking across runs with regression detection
- CI-ready with `--fail-on`
- Deterministic runs with seeded RNG
- Paste-able curl command for every bug
- JSON output with `--format json`
- Works with any OpenAPI 3.x spec (local file or remote URL)

## CLI Reference

```
npx havoc run
  --spec <path-or-url>        OpenAPI spec (required)
  --url <target>              API base URL (required)
  --agents <list>             Agents to run (default: all)
  --seed <number>             RNG seed (default: 42)
  --timeout <ms>              Attack timeout (default: 60000)
  --fail-on <condition>       CI gate: any_bugs | new_bugs | regressions | critical
  --format <format>           Output format: terminal | json (default: terminal)
  --output <path>             Write report to file
  -H "Key: Value"             Custom headers
```

## Try It

```bash
git clone <repo-url> && cd havoc && npm install

# Against Schemathesis demo (known bugs, zero setup)
npm run dev -- run \
  --spec https://example.schemathesis.io/openapi.json \
  --url https://example.schemathesis.io

# Against the included buggy test server
npm run test:server &
npm run dev -- run --spec ./test-server/openapi.yaml --url http://localhost:3000

# Run the test suite
npm test
```

## License

MIT
