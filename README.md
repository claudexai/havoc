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

## Agents

| Agent | Strategy | Status |
|-------|----------|--------|
| Boundary Walker | Edge values: min, max, min-1, max+1, null, empty, overflow | Done |
| Mutant Breeder | Field removal, injection (is_admin, price_override), type swaps, XSS/SQL probes | Done |
| Sequence Hunter | Stateful request chains (create -> delete -> verify) | Planned |
| Type Shapeshifter | Wrong types in correct structure | Planned |
| Slow Poison | Resource exhaustion, payload growth | Planned |
| Chaos Timer | Timing-based attacks, race conditions | Planned |
| Champion Evolver | Cross-breeds findings from all other agents | Planned |

## Oracle Layers

| Layer | What it checks | Status |
|-------|---------------|--------|
| 1. Schema Validation | Response matches spec, status codes make sense, types correct | Done |
| 2. Self-Consistency | Create->Read matches, list contains created item, counts correct | Planned |
| 3. Invariant Rules | User-defined assertions in YAML | Planned |
| 4. Metamorphic Relations | Subset, commutativity, pagination, sort reversal | Planned |
| 5. Differential Testing | Compare old vs new API version | Planned |
| 6. Lightweight Contracts | User-defined response contracts in YAML | Planned |

## Bug Reports

Every bug includes:
- Severity level (critical / high / medium / low)
- Which agent found it and which oracle layer detected it
- Paste-able curl command to reproduce
- Full request and response details

## Testing

```bash
# Run all tests (19 tests across 3 suites)
npm test

# Start the deliberately buggy test server
npm run test:server

# Then attack it
npm run dev -- run --spec ./test-server/openapi.yaml --url http://localhost:3000
```

## Tech Stack

- TypeScript (Node.js >= 22)
- Commander.js (CLI)
- @apidevtools/swagger-parser (OpenAPI parsing)
- @faker-js/faker (seed generation)
- Vitest (testing)

## License

MIT
