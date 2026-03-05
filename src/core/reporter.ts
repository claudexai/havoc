import { Bug, AgentResult } from "../types/index.js";

const SEVERITY_COLORS: Record<Bug["severity"], string> = {
  critical: "\x1b[31m", // red
  high: "\x1b[33m",     // yellow
  medium: "\x1b[36m",   // cyan
  low: "\x1b[90m",      // gray
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

export function reportBugs(bugs: Bug[], results: AgentResult[]): void {
  // Summary header
  console.log("═".repeat(60));
  console.log(`${BOLD}  HAVOC RESULTS${RESET}`);
  console.log("═".repeat(60));
  console.log();

  // Agent stats
  for (const result of results) {
    const bugCount = result.bugs.length;
    const time = (result.duration / 1000).toFixed(1);
    console.log(
      `  ${result.agent.padEnd(20)} ${String(result.requests_sent).padStart(5)} requests  ${String(bugCount).padStart(3)} bugs  ${time}s`
    );
  }
  console.log();

  const totalRequests = results.reduce((s, r) => s + r.requests_sent, 0);
  console.log(`  Total: ${totalRequests} requests, ${bugs.length} unique bugs\n`);

  if (bugs.length === 0) {
    console.log("  ✅ No bugs found!\n");
    return;
  }

  // Sort by severity
  const order: Record<Bug["severity"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  bugs.sort((a, b) => order[a.severity] - order[b.severity]);

  // Bug details
  console.log("─".repeat(60));
  console.log(`${BOLD}  BUGS${RESET}`);
  console.log("─".repeat(60));

  for (let i = 0; i < bugs.length; i++) {
    const bug = bugs[i];
    const color = SEVERITY_COLORS[bug.severity];
    console.log();
    console.log(
      `  ${color}${BOLD}[${bug.severity.toUpperCase()}]${RESET} ${bug.title}`
    );
    console.log(`  ${bug.description}`);
    console.log(`  Agent: ${bug.agent} | Oracle: Layer ${bug.oracle_layer} | Status: ${bug.response.status}`);
    console.log(`  Endpoint: ${bug.endpoint.id}`);
    console.log();
    console.log(`  ${BOLD}Reproduce:${RESET}`);
    console.log(`  ${bug.curl}`);
    if (i < bugs.length - 1) {
      console.log();
      console.log("  " + "·".repeat(56));
    }
  }

  console.log();
  console.log("═".repeat(60));

  // Severity summary
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const bug of bugs) counts[bug.severity]++;
  const parts = [];
  if (counts.critical > 0) parts.push(`${SEVERITY_COLORS.critical}${counts.critical} critical${RESET}`);
  if (counts.high > 0) parts.push(`${SEVERITY_COLORS.high}${counts.high} high${RESET}`);
  if (counts.medium > 0) parts.push(`${SEVERITY_COLORS.medium}${counts.medium} medium${RESET}`);
  if (counts.low > 0) parts.push(`${SEVERITY_COLORS.low}${counts.low} low${RESET}`);
  console.log(`  ${parts.join(" | ")}`);
  console.log("═".repeat(60));
  console.log();
}
