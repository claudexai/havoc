import { Command } from "commander";
import { run } from "../core/runner.js";

const program = new Command();

program
  .name("havoc")
  .description("Multi-agent API adversarial testing engine")
  .version("0.1.0");

program
  .command("run")
  .description("Run adversarial tests against an API")
  .requiredOption("--url <url>", "Target API base URL")
  .option("--spec <path>", "Path to OpenAPI/Swagger spec file")
  .option("--graphql <url>", "GraphQL endpoint URL (auto-introspection)")
  .option("-H, --header <headers...>", "Request headers (e.g. 'Authorization: Bearer token')")
  .option("--agents <agents>", "Comma-separated list of agents to run", "boundary_walker,mutant_breeder")
  .option("--timeout <ms>", "Attack phase timeout in ms", "60000")
  .option("--seed <number>", "RNG seed for deterministic runs", "42")
  .option("--fail-on <condition>", "Exit with code 1 if condition met (e.g. new_bugs)")
  .option("--format <format>", "Output format: terminal, json, junit", "terminal")
  .option("--output <path>", "Output file path")
  .action(async (opts) => {
    const headers: Record<string, string> = {};
    if (opts.header) {
      for (const h of opts.header) {
        const idx = h.indexOf(":");
        if (idx > 0) {
          headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
        }
      }
    }

    const enabledAgents = new Set(opts.agents.split(",").map((a: string) => a.trim()));

    await run({
      url: opts.url,
      spec: opts.spec,
      graphql: opts.graphql,
      headers,
      agents: {
        boundary_walker: enabledAgents.has("boundary_walker"),
        mutant_breeder: enabledAgents.has("mutant_breeder"),
        sequence_hunter: enabledAgents.has("sequence_hunter"),
        type_shapeshifter: enabledAgents.has("type_shapeshifter"),
        slow_poison: enabledAgents.has("slow_poison"),
        chaos_timer: enabledAgents.has("chaos_timer"),
        champion_evolver: enabledAgents.has("champion_evolver"),
      },
      timeout: parseInt(opts.timeout, 10),
      seed: parseInt(opts.seed, 10),
      failOn: opts.failOn,
    });
  });

program.parse();
