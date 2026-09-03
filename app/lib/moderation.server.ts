import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AppLoadContext } from "react-router";
import { StatusType } from "./constants";
import { getDB } from "./db";

export type IssueModerationInput = {
  routeId: number;
  issueType: string;
  subIssueType?: string | null;
  description?: string | null;
  boltsAffected?: string | null;
  reportedByUid?: string | null;
};

const SCRIPT_PATTERNS = [
  /<script\b/i,
  /<\/\s*script\b/i,
  /\bon[a-z]+\s*=/i, // inline event handlers, e.g. onload=, onerror=, onclick=
  /\bjavascript\s*:/i, // javascript: pseudo-protocol
  /<\s*(?:iframe|object|embed|applet)\b/i,
];

const HYPERLINK_PATTERNS = [
  /\b(?:https?|ftp):\/\/\S+/i,
  /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/i,
  /\[.*?\]\(.*?\)/, // Markdown link syntax
];

export function isDescriptionTooLong(description?: string | null): boolean {
  return typeof description === "string" && description.length > 1000;
}

export function containsScriptInjection(text?: string | null): boolean {
  if (!text || typeof text !== "string") return false;
  return SCRIPT_PATTERNS.some((pattern) => pattern.test(text));
}

export function containsHyperlink(text?: string | null): boolean {
  if (!text || typeof text !== "string") return false;
  return HYPERLINK_PATTERNS.some((pattern) => pattern.test(text));
}

export async function routeHasExistingIssue(
  context: AppLoadContext,
  routeId: number
): Promise<boolean> {
  const db = getDB(context);
  const existing = await db
    .selectFrom("issue")
    .select("id")
    .where("route_id", "=", routeId)
    .where((eb) =>
      eb.and([
        eb("status", "!=", "Deleted"),
        eb("status", "!=", "deleted"),
        eb("status", "!=", "Archived"),
        eb("status", "!=", "archived"),
        eb("status", "!=", "Completed"),
        eb("status", "!=", "completed"),
        eb("status", "!=", "Closed"),
        eb("status", "!=", "closed"),
      ])
    )
    .limit(1)
    .executeTakeFirst();

  return Boolean(existing);
}

export async function isTrustedSubmitter(
  context: AppLoadContext,
  userUid?: string | null
): Promise<boolean> {
  if (!userUid) return false;

  const db = getDB(context);
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const priorIssue = await db
    .selectFrom("issue")
    .select("id")
    .where("reported_by_uid", "=", userUid)
    .where("created_at", "<=", oneWeekAgo)
    .where((eb) =>
      eb.and([
        eb("status", "!=", "In Moderation"),
        eb("status", "!=", "in moderation"),
        eb("status", "!=", "Deleted"),
        eb("status", "!=", "deleted"),
      ])
    )
    .limit(1)
    .executeTakeFirst();

  return Boolean(priorIssue);
}

export async function evaluateWithGemini(
  context: AppLoadContext,
  params: IssueModerationInput
): Promise<StatusType> {
  const trimmedDescription = params.description?.trim();
  if (!trimmedDescription) {
    return "In Moderation";
  }

  const env = context.cloudflare?.env as unknown as Env | undefined;
  const apiKey = env?.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not configured; sending issue to moderation.");
    return "In Moderation";
  }

  let routeInfo = `Route ID: ${params.routeId}`;
  try {
    const db = getDB(context);
    const route = await db
      .selectFrom("route")
      .leftJoin("sector", "route.sector_id", "sector.id")
      .leftJoin("crag", "sector.crag_id", "crag.id")
      .where("route.id", "=", params.routeId)
      .select([
        "route.name as routeName",
        "sector.name as sectorName",
        "crag.name as cragName",
      ])
      .executeTakeFirst();

    if (route) {
      routeInfo = `Route: "${route.routeName || "Unknown"}", Sector: "${route.sectorName || "Unknown"}", Crag: "${route.cragName || "Unknown"}" (Route ID: ${params.routeId})`;
    }
  } catch {
    // If route details fetch fails, proceed with the routeId
  }

  const prompt = `You are a content moderation evaluator for a rock climbing community route maintenance application (Tabvar).
Climbers use this form to report safety issues, hardware damage, or route maintenance concerns.

Evaluate whether the following issue report constitutes a legitimate, plausible rock climbing route issue or condition report.

Issue Details:
- Target Route: ${routeInfo}
- Issue Category: ${params.issueType}
- Specific Issue: ${params.subIssueType || "Not specified"}
- Affected Bolts: ${params.boltsAffected || "None specified"}
- User Notes / Description:
"""
${trimmedDescription}
"""

Guidelines for Evaluation:
1. VALID REPORTS (isValid: true):
   - Mentions route conditions, hardware (bolts, anchors, chains, hangers, carabiners), rock quality (loose rock, flakes, rockfall), natural hazards (wasps, bees, birds, poison ivy, trees), access/approach/descent issues, or route info corrections.
   - Climbers often use shorthand, jargon, slang, and informal language (e.g., "spinner", "crux", "draw", "choss", "perma", "chains", "rap ring", "runout", "hollow flake", "pitch 2").
   - Brief notes or minor typos are completely normal and should be considered valid as long as they appear to be honest reports about climbing conditions or route hardware.

2. INVALID REPORTS (isValid: false):
   - Commercial spam, marketing promotions, advertising, or unsolicited solicitations.
   - Gibberish, keystroke mashing, or test submissions (e.g. "asdfghjkl", "test 123", "blah blah", "qwerty").
   - Harassment, threats, hate speech, vulgar abuse, or personal attacks.
   - Completely off-topic content unrelated to rock climbing, outdoor recreation, or route maintenance (e.g. political commentary, movie reviews, unrelated personal essays).

Provide your decision as a JSON object with:
- "isValid": boolean (true if the text likely constitutes a valid rock climbing route submission, false otherwise)
- "reason": string (brief explanation of your evaluation)
`;

  try {
    const ai = new GoogleGenerativeAI(apiKey);
    const model = ai.getGenerativeModel({
      model: "gemini-3.5-flash-lite",
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text) as { isValid?: boolean; reason?: string };

    if (parsed.isValid === true) {
      return "Reported";
    }
    return "In Moderation";
  } catch (error) {
    console.error("Gemini auto-moderation evaluation failed:", error);
    return "In Moderation";
  }
}

/**
 * Main entry point for issue moderation.
 * Evaluates deterministic checks -> submitter reputation -> Gemini 3.5 Flash-Lite.
 */
export async function evaluateIssueModeration(
  context: AppLoadContext,
  params: IssueModerationInput
): Promise<StatusType> {
  const allTextFields = [
    params.description,
    params.boltsAffected,
    params.subIssueType,
    params.issueType,
  ];

  // 1. Deterministic sanity checks
  // 1a. Description length > 1000 characters
  if (isDescriptionTooLong(params.description)) {
    return "In Moderation";
  }

  // 1b. Script injection attempt
  if (allTextFields.some((field) => containsScriptInjection(field))) {
    return "In Moderation";
  }

  // 1c. Route already has an active issue on it
  if (await routeHasExistingIssue(context, params.routeId)) {
    return "In Moderation";
  }

  // 1d. Any content contains a hyperlink
  if (allTextFields.some((field) => containsHyperlink(field))) {
    return "In Moderation";
  }

  // 2. Submitter reputation check
  if (await isTrustedSubmitter(context, params.reportedByUid)) {
    return "Reported";
  }

  // 3. AI evaluation (Gemini 3.5 Flash-Lite)
  return await evaluateWithGemini(context, params);
}
