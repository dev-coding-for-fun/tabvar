import { describe, expect, it } from "vitest";
import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { AgentReporter, formatCompactError, stripAnsi } from "./agent-reporter";

function createMockTestCase(overrides: {
  titlePath?: string[];
  file?: string;
  line?: number;
  column?: number;
  projectName?: string;
  outcome?: "expected" | "unexpected" | "skipped" | "flaky";
  results?: Partial<TestResult>[];
}): TestCase {
  const projectName = overrides.projectName ?? "chromium";
  const file = overrides.file ?? "x:/repo/e2e/discount.spec.ts";
  const titlePath = overrides.titlePath ?? ["", projectName, "e2e/discount.spec.ts", "as member", "sees discount"];

  return {
    titlePath: () => titlePath,
    location: { file, line: overrides.line ?? 17, column: overrides.column ?? 5 },
    outcome: () => overrides.outcome ?? "expected",
    parent: {
      project: () => ({ name: projectName }),
    },
    results: (overrides.results ?? [{ duration: 120, errors: [], attachments: [] }]) as TestResult[],
  } as unknown as TestCase;
}

describe("AgentReporter", () => {
  it("strips ANSI escape codes and node_modules stack frames in formatCompactError", () => {
    const formatted = formatCompactError(
      {
        message:
          "\u001b[31mError: expect(locator).toBeVisible() failed\u001b[39m\n" +
          "Expected: visible\n" +
          "Received: hidden\n" +
          "    at Object.<anonymous> (x:/repo/node_modules/playwright/lib/matchers.js:10:5)\n" +
          "    at x:/repo/e2e/discount.spec.ts:21:45",
      },
      10
    );

    expect(stripAnsi(formatted)).toBe(formatted);
    expect(formatted).toContain("Error: expect(locator).toBeVisible() failed");
    expect(formatted).not.toContain("node_modules");
    expect(formatted).toContain("at x:/repo/e2e/discount.spec.ts:21:45");
  });

  it("truncates overly long error messages to maxLines", () => {
    const manyLines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join("\n");
    const formatted = formatCompactError({ message: manyLines }, 5);
    const lines = formatted.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[5]).toContain("25 more lines omitted");
  });

  it("outputs a single summary line when all setup and spec tests pass", () => {
    const chunks: string[] = [];
    const reporter = new AgentReporter({ rootDir: "x:/repo", write: (text) => chunks.push(text) });

    const setupTest = createMockTestCase({ projectName: "setup", outcome: "expected" });
    const specTest1 = createMockTestCase({ projectName: "chromium", outcome: "expected" });
    const specTest2 = createMockTestCase({ projectName: "chromium", outcome: "expected" });

    reporter.onTestEnd(setupTest);
    reporter.onTestEnd(specTest1);
    reporter.onTestEnd(specTest2);
    reporter.onEnd({ status: "passed", duration: 2450 } as FullResult);

    expect(chunks.join("")).toBe("PASS: 2 passed, 1 setup (2.5s)\n");
  });

  it("outputs compact failure details, inline diagnostics, and artifact paths on failure", () => {
    const chunks: string[] = [];
    const reporter = new AgentReporter({ rootDir: "x:/repo", write: (text) => chunks.push(text) });

    const passingTest = createMockTestCase({ outcome: "expected" });
    const failingTest = createMockTestCase({
      outcome: "unexpected",
      file: "x:/repo/e2e/discount.spec.ts",
      line: 21,
      column: 7,
      titlePath: ["", "chromium", "e2e/discount.spec.ts", "as member", "sees discount management"],
      results: [
        {
          duration: 840,
          errors: [{ message: "\u001b[31mExpected: visible\u001b[39m\nReceived: hidden" }],
          attachments: [
            {
              name: "diagnostics",
              contentType: "text/plain",
              body: Buffer.from("[member HTTP 500] GET http://127.0.0.1:5173/discount"),
            },
            {
              name: "error-context",
              contentType: "text/markdown",
              path: "x:/repo/test-results/discount-member/error-context.md",
            },
            {
              name: "trace",
              contentType: "application/zip",
              path: "x:/repo/test-results/discount-member/trace.zip",
            },
          ],
        },
      ],
    });

    reporter.onTestEnd(passingTest);
    reporter.onTestEnd(failingTest);
    reporter.onEnd({ status: "failed", duration: 3100 } as FullResult);

    const output = chunks.join("");
    expect(output).toContain(
      "FAIL e2e/discount.spec.ts:21:7 › as member › sees discount management (840ms)"
    );
    expect(output).toContain("  Expected: visible\n  Received: hidden");
    expect(output).toContain("  Diagnostics (SSR / Console / Page Errors):");
    expect(output).toContain("    [member HTTP 500] GET http://127.0.0.1:5173/discount");
    expect(output).toContain(
      "  Error Context (DOM/ARIA): test-results/discount-member/error-context.md"
    );
    expect(output).toContain(
      "  Trace: test-results/discount-member/trace.zip (run: npx playwright trace open test-results/discount-member/trace.zip)"
    );
    expect(output).toContain("FAIL: 1 failed, 1 passed (3.1s)");
  });
});
