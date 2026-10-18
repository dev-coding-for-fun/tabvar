import path from "node:path";
import type {
  FullResult,
  Reporter,
  TestCase,
  TestError,
} from "@playwright/test/reporter";

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\u001b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, "");
}

export interface AgentReporterOptions {
  /** Maximum lines printed per error message before truncation (default: 25). */
  maxErrorLines?: number;
  /** Base directory for relative paths (defaults to process.cwd()). */
  rootDir?: string;
  /** Custom write function for testing (defaults to process.cwd()). */
  write?: (text: string) => void;
}

/**
 * Cleans a Playwright error message and stack for LLM consumption:
 * - Strips ANSI escape codes
 * - Removes internal node_modules stack frames
 * - Caps total lines to prevent context window bloat
 */
export function formatCompactError(error: TestError, maxLines = 25): string {
  const raw = stripAnsi(error.message || error.stack || "Unknown error");
  const filteredLines = raw
    .split(/\r?\n/)
    .filter((line) => !line.includes("node_modules"))
    // Collapse consecutive blank lines
    .filter((line, idx, arr) => line.trim() !== "" || (idx > 0 && arr[idx - 1].trim() !== ""));

  if (filteredLines.length <= maxLines) {
    return filteredLines.join("\n").trim();
  }

  const head = filteredLines.slice(0, maxLines);
  const omitted = filteredLines.length - maxLines;
  head.push(`... (${omitted} more lines omitted; see Error Context file for full details)`);
  return head.join("\n").trim();
}

/**
 * Compact, high-signal Playwright reporter designed for AI coding agents.
 *
 * - Outputs a single summary line when all tests pass (zero per-test log spam).
 * - On failure, outputs only failing tests with stripped assertion diffs,
 *   captured SSR/console diagnostics, and relative paths to `error-context.md`
 *   (ARIA snapshot) and `trace.zip` (for `npx playwright trace`).
 */
export class AgentReporter implements Reporter {
  private rootDir: string;
  private maxErrorLines: number;
  private write: (text: string) => void;
  private seenTests = new Set<TestCase>();
  private globalErrors: TestError[] = [];

  constructor(options: AgentReporterOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
    this.maxErrorLines = options.maxErrorLines ?? 25;
    this.write = options.write ?? ((text: string) => process.stdout.write(text));
  }

  printsToStdio(): boolean {
    return true;
  }

  onTestEnd(test: TestCase): void {
    this.seenTests.add(test);
  }

  onError(error: TestError): void {
    this.globalErrors.push(error);
  }

  onEnd(result: FullResult): void {
    let passedSpecs = 0;
    let passedSetup = 0;
    let skipped = 0;
    let flaky = 0;
    const unexpectedTests: TestCase[] = [];

    for (const test of this.seenTests) {
      const projectName = test.parent?.project()?.name;
      const outcome = test.outcome();

      if (outcome === "expected") {
        if (projectName === "setup" || projectName === "warmup") {
          passedSetup++;
        } else {
          passedSpecs++;
        }
      } else if (outcome === "skipped") {
        skipped++;
      } else if (outcome === "flaky") {
        flaky++;
      } else if (outcome === "unexpected") {
        unexpectedTests.push(test);
      }
    }

    const lines: string[] = [];

    for (const err of this.globalErrors) {
      lines.push("GLOBAL ERROR:");
      lines.push(this.indent(formatCompactError(err, this.maxErrorLines), "  "));
      lines.push("");
    }

    for (const test of unexpectedTests) {
      lines.push(this.formatFailedTest(test));
      lines.push("");
    }

    const durationSec = (result.duration / 1000).toFixed(1);
    const totalFailed = unexpectedTests.length + this.globalErrors.length;

    if (totalFailed === 0 && result.status === "passed") {
      const parts = [`${passedSpecs} passed`];
      if (passedSetup > 0) parts.push(`${passedSetup} setup`);
      if (flaky > 0) parts.push(`${flaky} flaky`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      lines.push(`PASS: ${parts.join(", ")} (${durationSec}s)`);
    } else {
      const parts = [`${unexpectedTests.length} failed`, `${passedSpecs} passed`];
      if (flaky > 0) parts.push(`${flaky} flaky`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (this.globalErrors.length > 0) parts.push(`${this.globalErrors.length} global error(s)`);
      lines.push(`FAIL: ${parts.join(", ")} (${durationSec}s)`);
    }

    this.write(lines.join("\n") + "\n");
  }

  private formatFailedTest(test: TestCase): string {
    const lastResult = test.results[test.results.length - 1];
    const relFile = this.relativePath(test.location.file);
    // titlePath() is ["", projectName, fileName, ...describes, testTitle]
    const titlePath = test
      .titlePath()
      .slice(3)
      .filter(Boolean)
      .join(" › ");
    const durationMs = lastResult ? `${lastResult.duration}ms` : "";

    const out: string[] = [
      `FAIL ${relFile}:${test.location.line}:${test.location.column} › ${titlePath}${durationMs ? ` (${durationMs})` : ""}`,
    ];

    if (!lastResult) {
      return out.join("\n");
    }

    for (const error of lastResult.errors) {
      const formatted = formatCompactError(error, this.maxErrorLines);
      if (formatted) {
        out.push(this.indent(formatted, "  "));
      }
    }

    const diagnostics = lastResult.attachments.find((a) => a.name === "diagnostics");
    if (diagnostics?.body) {
      const text = diagnostics.body.toString("utf8").trim();
      if (text) {
        out.push("  Diagnostics (SSR / Console / Page Errors):");
        out.push(this.indent(text, "    "));
      }
    }

    const errorContext = lastResult.attachments.find((a) => a.name === "error-context");
    if (errorContext?.path) {
      out.push(`  Error Context (DOM/ARIA): ${this.relativePath(errorContext.path)}`);
    }

    const trace = lastResult.attachments.find((a) => a.name === "trace");
    if (trace?.path) {
      const traceRel = this.relativePath(trace.path);
      out.push(`  Trace: ${traceRel} (run: npx playwright trace open ${traceRel})`);
    }

    return out.join("\n");
  }

  private relativePath(targetPath: string): string {
    return path.relative(this.rootDir, targetPath).replace(/\\/g, "/");
  }

  private indent(text: string, prefix: string): string {
    return text
      .split("\n")
      .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
      .join("\n");
  }
}

export default AgentReporter;
