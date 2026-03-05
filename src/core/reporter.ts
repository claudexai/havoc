import { Bug, AgentResult } from "../types/index.js";
import fs from "fs";

const SEVERITY_COLORS: Record<Bug["severity"], string> = {
  critical: "\x1b[31m", // red
  high: "\x1b[33m",     // yellow
  medium: "\x1b[36m",   // cyan
  low: "\x1b[90m",      // gray
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

interface TrackingInfo {
  newBugs: Bug[];
  regressions: Bug[];
  knownBugs: Bug[];
}

export function reportBugs(bugs: Bug[], results: AgentResult[], tracking?: TrackingInfo): void {
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

  // Tracking summary
  if (tracking) {
    const { newBugs, regressions, knownBugs } = tracking;
    const parts: string[] = [];
    if (newBugs.length > 0) parts.push(`${RED}${newBugs.length} new${RESET}`);
    if (regressions.length > 0) parts.push(`${RED}${regressions.length} regressions${RESET}`);
    if (knownBugs.length > 0) parts.push(`${knownBugs.length} known`);
    if (parts.length > 0) {
      console.log(`  Bug tracking: ${parts.join(" | ")}`);
      console.log();
    }
  }

  if (bugs.length === 0) {
    console.log(`  ${GREEN}No bugs found!${RESET}\n`);
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

  // Build sets for tracking labels
  const newFingerprints = new Set(tracking?.newBugs.map((b) => b.fingerprint));
  const regressionFingerprints = new Set(tracking?.regressions.map((b) => b.fingerprint));

  // Bug details
  console.log("─".repeat(60));
  console.log(`${BOLD}  BUGS${RESET}`);
  console.log("─".repeat(60));

  for (let i = 0; i < bugs.length; i++) {
    const bug = bugs[i];
    const color = SEVERITY_COLORS[bug.severity];

    // Tracking label
    let label = "";
    if (newFingerprints.has(bug.fingerprint)) label = ` ${RED}[NEW]${RESET}`;
    else if (regressionFingerprints.has(bug.fingerprint)) label = ` ${RED}[REGRESSION]${RESET}`;

    console.log();
    console.log(
      `  ${color}${BOLD}[${bug.severity.toUpperCase()}]${RESET} ${bug.title}${label}`
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

export function reportJson(
  bugs: Bug[],
  results: AgentResult[],
  tracking?: TrackingInfo,
  outputPath?: string
): void {
  const newFingerprints = new Set(tracking?.newBugs.map((b) => b.fingerprint));
  const regressionFingerprints = new Set(tracking?.regressions.map((b) => b.fingerprint));

  const report = {
    summary: {
      total_requests: results.reduce((s, r) => s + r.requests_sent, 0),
      total_bugs: bugs.length,
      new_bugs: tracking?.newBugs.length ?? 0,
      regressions: tracking?.regressions.length ?? 0,
      known_bugs: tracking?.knownBugs.length ?? 0,
      severity: {
        critical: bugs.filter((b) => b.severity === "critical").length,
        high: bugs.filter((b) => b.severity === "high").length,
        medium: bugs.filter((b) => b.severity === "medium").length,
        low: bugs.filter((b) => b.severity === "low").length,
      },
    },
    agents: results.map((r) => ({
      name: r.agent,
      requests_sent: r.requests_sent,
      bugs_found: r.bugs.length,
      duration_ms: Math.round(r.duration),
    })),
    bugs: bugs.map((b) => ({
      fingerprint: b.fingerprint,
      severity: b.severity,
      title: b.title,
      description: b.description,
      agent: b.agent,
      oracle_layer: b.oracle_layer,
      endpoint: b.endpoint.id,
      status: newFingerprints.has(b.fingerprint)
        ? "new"
        : regressionFingerprints.has(b.fingerprint)
          ? "regression"
          : "known",
      request: b.request,
      response: {
        status: b.response.status,
        timing: Math.round(b.response.timing),
      },
      curl: b.curl,
    })),
  };

  const json = JSON.stringify(report, null, 2);

  if (outputPath) {
    fs.writeFileSync(outputPath, json);
    console.log(`  JSON report written to ${outputPath}\n`);
  } else {
    console.log(json);
  }
}
