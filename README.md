# Havoc

Multi-agent API adversarial testing engine. Multiple deterministic agents simultaneously attack an API from different angles, cross-breed findings, and validate results through oracle layers.

## Quick Start

```bash
# Install dependencies
npm install

# Run against any API with an OpenAPI spec
npm run dev -- run --spec ./path/to/openapi.yaml --url http://localhost:3000

# Works with remote specs too
npm run dev -- run --spec https://petstore3.swagger.io/api/v3/openapi.json --url https://petstore3.swagger.io/api/v3
```

## CLI Options

```bash
npm run dev -- run \
  --spec <path-or-url>         # OpenAPI/Swagger spec (required for now)
  --url <target>               # Target API base URL
  --agents <list>              # Comma-separated agents (default: boundary_walker,mutant_breeder)
  --seed <number>              # RNG seed for deterministic runs (default: 42)
  --timeout <ms>               # Attack phase timeout (default: 60000)
  --fail-on <condition>        # Exit code 1 if: any_bugs, new_bugs, regressions, critical
  -H "Header: value"           # Custom headers (e.g. auth)
```

## How It Works

Havoc runs a 6-step pipeline:

1. **DISCOVER** -- Parse OpenAPI spec into a universal endpoint model
2. **SEED** -- Generate valid requests from spec constraints using Faker
3. **BASELINE** -- Send seeds 5x, record normal status/timing/schema
4. **ATTACK** -- All agents run in parallel, mutating seeds and checking responses
5. **MINIMIZE** -- Delta debugging to find smallest reproducing input (coming soon)
6. **REPORT** -- Terminal output with severity, descriptions, and curl commands

---

## Agents

Each agent attacks the API from a different angle. They all read the same OpenAPI spec and generate tests automatically -- zero config needed.

### Boundary Walker

Tests value limits from spec constraints. If the spec says `minimum: 1, maximum: 100`, it tries 0, 1, 100, 101, -1, MAX_INT, null, and empty.

```
Spec says: { "price": number, minimum: 0.01, maximum: 999999.99 }

Boundary Walker sends:
  { "price": 0.01 }           -- at minimum
  { "price": 0 }              -- below minimum
  { "price": -1 }             -- negative
  { "price": 999999.99 }      -- at maximum
  { "price": 1000000 }        -- above maximum
  { "price": 9007199254740991 } -- MAX_SAFE_INTEGER
  { "price": null }            -- null
  {}                           -- missing entirely

Also tests:
  - Removing each required field one at a time
  - Empty strings, whitespace-only strings
  - Strings at maxLength and maxLength+1
  - Invalid enum values, lowercase variants
  - Empty arrays, arrays exceeding maxItems
```

### Mutant Breeder

Takes valid requests and makes targeted mutations. Tests structure, not just values.

```
Valid seed: { "name": "Widget", "price": 9.99, "category": "tools" }

Mutant Breeder sends:

  Field removal:
    { "price": 9.99, "category": "tools" }        -- removed name
    { "name": "Widget", "category": "tools" }      -- removed price

  Field injection:
    { ...valid, "is_admin": true }                  -- privilege escalation
    { ...valid, "price_override": 0.01 }            -- business logic bypass
    { ...valid, "role": "admin" }                    -- role injection
    { ...valid, "__proto__": { "admin": true } }     -- prototype pollution

  Value probes:
    { "name": "Widget'" }                           -- SQL injection probe
    { "name": "Widget<script>" }                    -- XSS probe
    { "name": "../../../etc/passwd" }               -- path traversal

  Structure mutations:
    { "NAME": "Widget", "name": "Widget" }          -- duplicate with case change
    { "name": 9.99, "price": "Widget" }             -- swap field values
    ""                                               -- empty string body
    []                                               -- array instead of object
```

### Type Shapeshifter

Sends correct structure but wrong types. Different from Boundary Walker (value limits) and Mutant Breeder (structure). Shapeshifter tests type confusion.

```
Spec says: { "quantity": integer, "product_id": string, "active": boolean }

Type Shapeshifter sends:

  String where integer expected:
    { "quantity": "2" }             -- server might parseInt() silently
    { "quantity": "two" }           -- non-numeric string
    { "quantity": "0x10" }          -- hex string
    { "quantity": "1e5" }           -- scientific notation

  Float where integer expected:
    { "quantity": 2.7 }             -- can you order 2.7 items?

  Integer where string expected:
    { "product_id": 12345 }         -- number not string

  Boolean where string expected:
    { "product_id": true }          -- boolean not string

  Object where array expected:
    { "items": { "id": "laptop" } } -- server calls .map() and crashes

  Deeply nested:
    { "data": { "a": { "b": { "c": { ... 50 levels ... }}}}}

  Null bytes:
    { "product_id": "laptop\u0000admin" }  -- truncation attack

  Extreme strings:
    { "product_id": "a" x 1000000 }       -- 1MB string
```

The difference between agents:
```
Boundary Walker:   "quantity max is 99, try 100"           -- VALUE limits
Mutant Breeder:    "add is_admin: true to the body"        -- STRUCTURE
Type Shapeshifter: "quantity expects int, send a string"   -- TYPES
```

---

## Oracle Layers

Every response goes through multiple validation layers. Each catches different kinds of bugs.

### Layer 1: Status/Input Validation

Checks if status codes make sense based on what was sent.

```
Rule: Invalid input should get 4xx, not 2xx
  Send: { "price": -1 }  (below spec minimum)
  Got:  200 OK
  BUG: Invalid input accepted -- server should reject this

Rule: Valid input should not get 4xx
  Send: { "name": "Widget", "price": 9.99, "category": "tools" }
  Got:  422 Unprocessable
  BUG: Valid input rejected

Rule: 500 is always a bug
  Send: anything
  Got:  500 Internal Server Error
  BUG: Server crashed
```

### Layer 2: Self-Consistency Checks

Uses the API against itself. No need to know the correct answer -- just check if the API contradicts itself.

```
Create -> Read -> Compare:
  POST /products { "name": "Widget", "price": 9.99 }
    -> 201 { "id": "42", "price": 9.99 }
  GET /products/42
    -> 200 { "id": "42", "price": 14.99 }
  BUG: Created with price 9.99 but read back 14.99

Delete -> Verify gone:
  DELETE /products/42 -> 200 OK
  GET /products/42    -> 200 { ... still there }
  BUG: Deleted but GET returns 200 instead of 404

Count mismatch:
  GET /products -> { "items": [3 items], "count": 50 }
  BUG: Response has 3 items but count field says 50

Idempotent GET:
  GET /orders/1 -> { "total": 99.99 }
  GET /orders/1 -> { "total": 101.50 }
  BUG: Same GET, different result, nothing changed between calls
```

### Layer 3: Response Schema Validation

Deep validation of response body against the spec. Layer 1 only checks status codes -- Layer 3 checks every field in the response.

```
Spec says GET /orders/123 returns:
  required: [id, status, total, items]
  id:     string
  status: string, enum: [pending, shipped, delivered]
  total:  number, minimum: 0
  items:  array, minItems: 1

Actual response:
  { "id": 12345, "status": "PENDING", "items": [], "currency": "USD" }

Layer 3 catches:
  "id" -- expected string, got number (12345)
  "status" -- "PENDING" not in enum [pending, shipped, delivered]
  "total" -- required field missing entirely
  "items" -- array has 0 items, spec says minimum 1

Layer 1 would say: "Status 200, looks fine!" -- MISSES ALL OF THESE
```

### Layers 4-6 (Planned)

| Layer | What it will check |
|-------|-------------------|
| 4. Metamorphic Relations | Subset, commutativity, pagination, sort reversal |
| 5. Differential Testing | Compare old vs new API version |
| 6. Lightweight Contracts | User-defined response contracts in YAML |

---

## Bug Tracking

Every bug gets a deterministic fingerprint and is tracked across runs in SQLite (`~/.havoc/history.db`).

```
Run 1 (Monday):
  Found 5 bugs -> all marked NEW
  Report: "5 new bugs"

Run 2 (Tuesday -- developer fixed 2 bugs):
  Found 3 bugs -> compared against history
  Report: "3 known, 2 fixed"

Run 3 (Wednesday -- broke something again):
  Found 4 bugs -> one previously fixed bug is back
  Report: "3 known, 1 REGRESSION"
```

Use `--fail-on` for CI pipelines:
```bash
# Fail if any new bugs are found (ignore known ones)
havoc run --spec ./api.yaml --url http://localhost:3000 --fail-on new_bugs

# Fail if a fixed bug comes back
havoc run --spec ./api.yaml --url http://localhost:3000 --fail-on regressions

# Fail on any critical severity bugs
havoc run --spec ./api.yaml --url http://localhost:3000 --fail-on critical
```

Query the database directly:
```bash
# See run history
sqlite3 -header -column ~/.havoc/history.db "SELECT * FROM runs ORDER BY id DESC LIMIT 5;"

# See open bugs
sqlite3 -header -column ~/.havoc/history.db "SELECT * FROM bugs WHERE status IN ('open', 'regression');"

# Bug count by severity
sqlite3 ~/.havoc/history.db "SELECT severity, COUNT(*) FROM bugs GROUP BY severity;"

# Clear tracking and start fresh
rm ~/.havoc/history.db
```

---

## Bug Reports

Every bug includes:
- Severity level (critical / high / medium / low)
- Which agent found it and which oracle layer detected it
- `[NEW]` or `[REGRESSION]` label from bug tracking
- Paste-able curl command to reproduce
- Full request and response details

## Testing

```bash
# Run all tests (37 tests across 5 suites)
npm test

# Start the deliberately buggy test server
npm run test:server

# Then attack it
npm run dev -- run --spec ./test-server/openapi.yaml --url http://localhost:3000
```

Results are deterministic when the target server restarts between runs (same seed + same starting state = same results).

## Tech Stack

- TypeScript (Node.js >= 22)
- Commander.js (CLI)
- @apidevtools/swagger-parser (OpenAPI parsing)
- @faker-js/faker (seed generation)
- better-sqlite3 (bug tracking)
- Vitest (testing)

## License

MIT
