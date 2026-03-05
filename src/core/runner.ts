import { HavocConfig, HavocEndpoint, Bug, AgentResult } from "../types/index.js";
import { discover } from "../adapters/openapi.js";
import { generateSeeds, Seed } from "../core/seed.js";
import { HavocTransport } from "../transport/rest.js";
import { runBaseline, Baseline } from "../core/baseline.js";
import { reportBugs } from "../core/reporter.js";

export async function run(config: HavocConfig): Promise<void> {
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

  const agentResults = await Promise.all(agentPromises);
  for (const result of agentResults) {
    results.push(result);
    allBugs.push(...result.bugs);
  }

  // Step 5: MINIMIZE (placeholder — delta debugging comes later)
  console.log("\n[5/6] MINIMIZE — Reducing bug inputs...");
  console.log(`  ${allBugs.length} bugs to minimize (skipping for now)\n`);

  // Step 6: REPORT
  console.log("[6/6] REPORT\n");
  reportBugs(allBugs, results);
}
