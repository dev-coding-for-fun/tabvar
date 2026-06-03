// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createContext } from "~/test/helpers";
import {
  addQueryParam,
  bearerToken,
  generateSecret,
  hashSecret,
  isAllowedTopobuilderReturnTo,
  ticketExpiresAt,
} from "./topobuilderAuth.server";

describe("topobuilder auth helpers", () => {
  it("allows the native TopoBuilder callback scheme", () => {
    expect(isAllowedTopobuilderReturnTo("topobuilder://tabvar-connect", createContext())).toBe(true);
  });

  it("rejects arbitrary callback URLs", () => {
    expect(isAllowedTopobuilderReturnTo("https://evil.example.com/callback", createContext())).toBe(false);
  });

  it("allows configured production web origins", () => {
    const context = createContext({
      ENVIRONMENT: "production",
      TOPOBUILDER_RETURN_TO_ALLOWLIST: "topobuilder:,https://topobuilder.example.com",
    });

    expect(isAllowedTopobuilderReturnTo("https://topobuilder.example.com/tabvar-connect", context)).toBe(true);
  });

  it("generates prefixed secrets and hashes without exposing the raw value", async () => {
    const secret = generateSecret("tb_token");
    const hash = await hashSecret(secret);

    expect(secret).toMatch(/^tb_token_/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(secret);
  });

  it("adds callback query params without losing existing params", () => {
    expect(addQueryParam("topobuilder://tabvar-connect?source=settings", "ticket", "abc")).toBe(
      "topobuilder://tabvar-connect?source=settings&ticket=abc"
    );
  });

  it("sets ticket expiry relative to the current time", () => {
    expect(ticketExpiresAt(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01T00:05:00.000Z");
  });

  it("parses bearer tokens", () => {
    const request = new Request("https://example.com/api", {
      headers: { Authorization: "Bearer tb_token_abc" },
    });

    expect(bearerToken(request)).toBe("tb_token_abc");
  });
});
