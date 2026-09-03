#!/usr/bin/env node

import fs from "node:fs";

function main() {
  let input = "";

  try {
    input = fs.readFileSync(0, "utf-8");
  } catch {
    // If reading stdin fails, allow execution safely
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }

  if (!input.trim()) {
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }

  try {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    const jsonStr = start !== -1 && end !== -1 && end > start ? input.slice(start, end + 1) : input;
    const payload = JSON.parse(jsonStr);
    const commandLine = payload?.toolCall?.args?.CommandLine || "";

    const isRemoteDbOperation =
      commandLine.includes("--remote") ||
      commandLine.includes("db:migrate:production") ||
      commandLine.includes("apply-production-d1-migrations");

    if (isRemoteDbOperation) {
      console.log(
        JSON.stringify({
          decision: "ask",
          reason: `Requires human confirmation before executing remote production database commands: "${commandLine}"`,
        })
      );
      return;
    }

    console.log(JSON.stringify({ decision: "allow" }));
  } catch {
    console.log(JSON.stringify({ decision: "allow" }));
  }
}

main();
