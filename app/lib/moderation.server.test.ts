import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createMockDb } from "~/test/helpers";
import {
  containsHyperlink,
  containsScriptInjection,
  evaluateIssueModeration,
  evaluateWithGemini,
  isDescriptionTooLong,
  isTrustedSubmitter,
  routeHasExistingIssue,
} from "./moderation.server";

// Mock @google/generative-ai
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn().mockReturnValue({
  generateContent: mockGenerateContent,
});

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.getGenerativeModel = mockGetGenerativeModel;
    return this;
  }),
}));

const mockGetDB = vi.fn();
vi.mock("~/lib/db", () => ({
  getDB: (context: unknown) => mockGetDB(context),
}));

describe("moderation.server deterministic checks", () => {
  describe("isDescriptionTooLong", () => {
    it("returns false for undefined or null", () => {
      expect(isDescriptionTooLong(undefined)).toBe(false);
      expect(isDescriptionTooLong(null)).toBe(false);
    });

    it("returns false for descriptions 1000 characters or fewer", () => {
      expect(isDescriptionTooLong("a".repeat(1000))).toBe(false);
      expect(isDescriptionTooLong("Normal climbing note")).toBe(false);
    });

    it("returns true for descriptions exceeding 1000 characters", () => {
      expect(isDescriptionTooLong("a".repeat(1001))).toBe(true);
    });
  });

  describe("containsScriptInjection", () => {
    it("detects <script> tags", () => {
      expect(containsScriptInjection("<script>alert(1)</script>")).toBe(true);
      expect(containsScriptInjection("<SCRIPT src='evil.js'></SCRIPT>")).toBe(true);
    });

    it("detects inline event handlers", () => {
      expect(containsScriptInjection("<img src=x onerror=alert(1)>")).toBe(true);
      expect(containsScriptInjection("<div onload = 'doBadThing()'>")).toBe(true);
      expect(containsScriptInjection("onclick=bad()")).toBe(true);
    });

    it("detects javascript: pseudo-protocol", () => {
      expect(containsScriptInjection("javascript:alert(1)")).toBe(true);
      expect(containsScriptInjection("JAVASCRIPT:void(0)")).toBe(true);
    });

    it("detects malicious embed tags", () => {
      expect(containsScriptInjection("<iframe src='bad.html'></iframe>")).toBe(true);
      expect(containsScriptInjection("<embed src='bad.swf'>")).toBe(true);
      expect(containsScriptInjection("<object data='bad.swf'>")).toBe(true);
    });

    it("does not trigger on standard climbing text with comparison symbols", () => {
      expect(containsScriptInjection("Grade is 5.10a < 5.10b, bolt 2 is > 3m off the deck")).toBe(false);
      expect(containsScriptInjection("Anchor chains are rusted, bolt #1 spinner")).toBe(false);
    });
  });

  describe("containsHyperlink", () => {
    it("detects http and https URLs", () => {
      expect(containsHyperlink("Visit http://spam.example.com for deals")).toBe(true);
      expect(containsHyperlink("Check https://malicious.org/download")).toBe(true);
    });

    it("detects www. links", () => {
      expect(containsHyperlink("Go to www.freerockclimbinggear.com")).toBe(true);
    });

    it("detects markdown style links", () => {
      expect(containsHyperlink("[click here](http://phishing.com)")).toBe(true);
    });

    it("does not flag ordinary climbing notes", () => {
      expect(containsHyperlink("Spinner on bolt 2, anchor chains need maintenance")).toBe(false);
      expect(containsHyperlink("Approach via trail near sector B")).toBe(false);
    });
  });
});

describe("routeHasExistingIssue", () => {
  it("returns true if an active issue exists on the route", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: 42 } }],
    });
    mockGetDB.mockReturnValue(db);

    const context = createContext();
    const result = await routeHasExistingIssue(context, 100);

    expect(result).toBe(true);
    expect(db.selectFrom).toHaveBeenCalledWith("issue");
  });

  it("returns false if no active issue exists on the route", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: undefined }],
    });
    mockGetDB.mockReturnValue(db);

    const context = createContext();
    const result = await routeHasExistingIssue(context, 100);

    expect(result).toBe(false);
  });
});

describe("isTrustedSubmitter", () => {
  it("returns false if no user UID is provided", async () => {
    const context = createContext();
    expect(await isTrustedSubmitter(context, null)).toBe(false);
    expect(await isTrustedSubmitter(context, undefined)).toBe(false);
  });

  it("returns true if user has a prior issue submitted >= 1 week ago in non-moderation/non-deleted status", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: 77 } }],
    });
    mockGetDB.mockReturnValue(db);

    const context = createContext();
    const result = await isTrustedSubmitter(context, "trusted-user-1");

    expect(result).toBe(true);
    expect(db.selectFrom).toHaveBeenCalledWith("issue");
  });

  it("returns false if user has no qualifying prior issues", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: undefined }],
    });
    mockGetDB.mockReturnValue(db);

    const context = createContext();
    const result = await isTrustedSubmitter(context, "new-user-2");

    expect(result).toBe(false);
  });
});

describe("evaluateWithGemini", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'In Moderation' if description is empty or whitespace", async () => {
    const context = createContext({ GEMINI_API_KEY: "test-api-key" });
    const result = await evaluateWithGemini(context, {
      routeId: 10,
      issueType: "Bolts",
      description: "   ",
    });

    expect(result).toBe("In Moderation");
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("returns 'In Moderation' if GEMINI_API_KEY is not configured", async () => {
    const context = createContext({ GEMINI_API_KEY: "" });
    const result = await evaluateWithGemini(context, {
      routeId: 10,
      issueType: "Bolts",
      description: "Spinner on bolt 2",
    });

    expect(result).toBe("In Moderation");
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("returns 'Reported' when Gemini classifies the submission as valid", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { routeName: "Test Climb", sectorName: "Main", cragName: "Crag A" } }],
    });
    mockGetDB.mockReturnValue(db);

    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({ isValid: true, reason: "Describes loose bolt on climbing route." }),
      },
    });

    const context = createContext({ GEMINI_API_KEY: "test-api-key" });
    const result = await evaluateWithGemini(context, {
      routeId: 10,
      issueType: "Bolts",
      subIssueType: "Loose bolt",
      boltsAffected: "2",
      description: "Bolt 2 spins freely by hand. Needs tightening or replacement.",
    });

    expect(result).toBe("Reported");
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-3.5-flash-lite" })
    );
  });

  it("returns 'In Moderation' when Gemini classifies the submission as invalid (spam/gibberish)", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: undefined }],
    });
    mockGetDB.mockReturnValue(db);

    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({ isValid: false, reason: "Gibberish content." }),
      },
    });

    const context = createContext({ GEMINI_API_KEY: "test-api-key" });
    const result = await evaluateWithGemini(context, {
      routeId: 10,
      issueType: "Bolts",
      description: "asdfghjkl qwerty 12345",
    });

    expect(result).toBe("In Moderation");
  });

  it("falls back safely to 'In Moderation' on Gemini API error", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: undefined }],
    });
    mockGetDB.mockReturnValue(db);

    mockGenerateContent.mockRejectedValue(new Error("API rate limit exceeded"));

    const context = createContext({ GEMINI_API_KEY: "test-api-key" });
    const result = await evaluateWithGemini(context, {
      routeId: 10,
      issueType: "Bolts",
      description: "Bolt 2 spins freely.",
    });

    expect(result).toBe("In Moderation");
  });
});

describe("evaluateIssueModeration complete pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends to 'In Moderation' when description exceeds 1000 characters", async () => {
    const context = createContext();
    const result = await evaluateIssueModeration(context, {
      routeId: 10,
      issueType: "Bolts",
      description: "x".repeat(1001),
      reportedByUid: "trusted-user",
    });

    expect(result).toBe("In Moderation");
    expect(mockGetDB).not.toHaveBeenCalled();
  });

  it("sends to 'In Moderation' when script injection is detected in any field", async () => {
    const context = createContext();
    const result = await evaluateIssueModeration(context, {
      routeId: 10,
      issueType: "Bolts",
      boltsAffected: "<script>alert(1)</script>",
      description: "Normal description",
    });

    expect(result).toBe("In Moderation");
    expect(mockGetDB).not.toHaveBeenCalled();
  });

  it("sends to 'In Moderation' when the route already has an active issue", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: 99 } }], // existing issue found
    });
    mockGetDB.mockReturnValue(db);

    const context = createContext();
    const result = await evaluateIssueModeration(context, {
      routeId: 10,
      issueType: "Bolts",
      description: "Second bolt spinner",
      reportedByUid: "trusted-user",
    });

    expect(result).toBe("In Moderation");
  });

  it("sends to 'In Moderation' when a hyperlink is found in any field", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: undefined }], // no existing issue on route
    });
    mockGetDB.mockReturnValue(db);

    const context = createContext();
    const result = await evaluateIssueModeration(context, {
      routeId: 10,
      issueType: "Bolts",
      description: "Check out https://mysite.com for gear discounts",
      reportedByUid: "trusted-user",
    });

    expect(result).toBe("In Moderation");
  });

  it("submits straight to 'Reported' if user is trusted (qualified prior issues)", async () => {
    const db = createMockDb({
      select: [
        { executeTakeFirst: undefined }, // no existing issue on route
        { executeTakeFirst: { id: 123 } }, // prior qualified issue found
      ],
    });
    mockGetDB.mockReturnValue(db);

    const context = createContext();
    const result = await evaluateIssueModeration(context, {
      routeId: 10,
      issueType: "Bolts",
      description: "Loose bolt on pitch 1",
      reportedByUid: "trusted-climber",
    });

    expect(result).toBe("Reported");
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("proceeds to Gemini when user is not trusted and description is provided", async () => {
    const db = createMockDb({
      select: [
        { executeTakeFirst: undefined }, // no existing issue on route
        { executeTakeFirst: undefined }, // not a trusted user
        { executeTakeFirst: { routeName: "The Prow" } }, // route info lookup
      ],
    });
    mockGetDB.mockReturnValue(db);

    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({ isValid: true, reason: "Legitimate route issue report." }),
      },
    });

    const context = createContext({ GEMINI_API_KEY: "test-api-key" });
    const result = await evaluateIssueModeration(context, {
      routeId: 10,
      issueType: "Bolts",
      subIssueType: "Loose bolt",
      boltsAffected: "1",
      description: "First bolt hanger is loose and spinning.",
      reportedByUid: "new-climber",
    });

    expect(result).toBe("Reported");
    expect(mockGenerateContent).toHaveBeenCalled();
  });
});
