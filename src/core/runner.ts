import { HavocConfig, HavocEndpoint, Bug, AgentResult } from "../types/index.js";
import { discover } from "../adapters/openapi.js";
import { generateSeeds, Seed } from "../core/seed.js";
import { HavocTransport } from "../transport/rest.js";
import { runBaseline, Baseline } from "../core/baseline.js";
import { ConsistencyChecker } from "../oracles/consistency.js";
import { BugTracker } from "../core/bug-tracker.js";
import { reportBugs, reportJson } from "../core/reporter.js";

export async function run(config: HavocConfig): Promise<void> {
  const runStart = performance.now();
  console.log("\n⚔️  HAVOC — Multi-Agent API Adversarial Testing Engine\n");

  // Step 1: DISCOVER
  console.log("[1/6] DISCOVER — Parsing API spec...");
  let endpoints: HavocEndpoint[];
  if (config.spec) {
    endpoints = await discover(config.spec);
  } else {
    console.error("Error: --spec is required for now (auto-discovery coming later)");
    process.exit(1);
  }
  console.log(`  Found ${endpoints.length} endpoints\n`);

  // Step 2: SEED
  console.log("[2/6] SEED — Generating valid requests...");
  const transport = new HavocTransport(config.url, config.headers);
  const seeds = generateSeeds(endpoints, config.seed);
  console.log(`  Generated ${seeds.length} seed requests\n`);

  // Step 3: BASELINE
  console.log("[3/6] BASELINE — Recording normal behavior...");
  const baselines = await runBaseline(transport, seeds);
  console.log(`  Baselined ${baselines.length} endpoints\n`);

  // Step 4: ATTACK
  console.log("[4/6] ATTACK — Agents engaging...\n");
  const allBugs: Bug[] = [];
  const results: AgentResult[] = [];

  // Load and run enabled agents in parallel
  const agentPromises: Promise<AgentResult>[] = [];

  if (config.agents.boundary_walker) {
    const { BoundaryWalker } = await import("../agents/boundary-walker.js");
    const agent = new BoundaryWalker(transport, endpoints, seeds, baselines, config.seed);
    agentPromises.push(agent.run());
  }

  if (config.agents.mutant_breeder) {
    const { MutantBreeder } = await import("../agents/mutant-breeder.js");
    const agent = new MutantBreeder(transport, endpoints, seeds, baselines, config.seed);
    agentPromises.push(agent.run());
  }

  if (config.agents.type_shapeshifter) {
    const { TypeShapeshifter } = await import("../agents/type-shapeshifter.js");
    const agent = new TypeShapeshifter(transport, endpoints, seeds, baselines, config.seed);
    agentPromises.push(agent.run());
  }

  const agentResults = await Promise.all(agentPromises);
  for (const result of agentResults) {
    results.push(result);
    allBugs.push(...result.bugs);
  }

  // Oracle Layer 2: Self-consistency checks (runs after agents)
  console.log("\n  [Consistency Checker] Running self-consistency checks...");
  const consistencyStart = performance.now();
  const consistency = new ConsistencyChecker(transport, endpoints, seeds);
  const consistencyResult = await consistency.run("consistency_checker", 1);
  const consistencyDuration = performance.now() - consistencyStart;
  allBugs.push(...consistencyResult.bugs);
  results.push({
    agent: "consistency_checker",
    bugs: consistencyResult.bugs,
    requests_sent: consistencyResult.requests,
    duration: consistencyDuration,
  });
  console.log(
    `  [Consistency Checker] Done — ${consistencyResult.requests} requests, ${consistencyResult.bugs.length} bugs found`
  );

  // Oracle layer summary
  const layerCounts: Record<number, number> = {};
  for (const bug of allBugs) {
    layerCounts[bug.oracle_layer] = (layerCounts[bug.oracle_layer] || 0) + 1;
  }
  const layerNames: Record<number, string> = {
    1: "Status/Input Validation",
    2: "Self-Consistency",
    3: "Response Schema",
  };
  console.log("\n  Oracle layers:");
  for (const [layer, name] of Object.entries(layerNames)) {
    const count = layerCounts[Number(layer)] || 0;
    const icon = count > 0 ? `${count} bugs` : "clean";
    console.log(`    Layer ${layer}: ${name} — ${icon}`);
  }

  // Step 5: MINIMIZE (placeholder — delta debugging comes later)
  console.log("\n[5/6] MINIMIZE — Reducing bug inputs...");
  console.log(`  ${allBugs.length} bugs to minimize (skipping for now)\n`);

  // Step 6: REPORT
  console.log("[6/6] REPORT\n");

  // Deduplicate bugs across agents by fingerprint
  const seen = new Set<string>();
  const uniqueBugs = allBugs.filter((b) => {
    if (seen.has(b.fingerprint)) return false;
    seen.add(b.fingerprint);
    return true;
  });

  // Track bugs in SQLite
  const runDuration = performance.now() - runStart;
  const tracker = new BugTracker();
  const { newBugs, regressions, knownBugs } = tracker.trackBugs(
    uniqueBugs, config.url, endpoints.length, runDuration
  );
  tracker.close();

  const trackingInfo = { newBugs, regressions, knownBugs };
  if (config.format === "json") {
    reportJson(uniqueBugs, results, trackingInfo, config.output);
  } else {
    reportBugs(uniqueBugs, results, trackingInfo);
  }

  // --fail-on support
  if (config.failOn) {
    const shouldFail = checkFailOn(config.failOn, uniqueBugs, newBugs, regressions);
    if (shouldFail) {
      console.log(`\n  --fail-on ${config.failOn} triggered. Exiting with code 1.\n`);
      process.exit(1);
    }
  }
}

export function checkFailOn(
  condition: string,
  allBugs: Bug[],
  newBugs: Bug[],
  regressions: Bug[]
): boolean {
  switch (condition) {
    case "any_bugs":
      return allBugs.length > 0;
    case "new_bugs":
      return newBugs.length > 0;
    case "regressions":
      return regressions.length > 0;
    case "critical":
      return allBugs.some((b) => b.severity === "critical");
    default:
      return false;
  }
}
