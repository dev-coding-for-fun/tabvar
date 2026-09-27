// @vitest-environment node

import { describe, expect, it } from "vitest";
import { getSafeRedirectTo } from "./redirects";

describe("getSafeRedirectTo", () => {
  it("returns null for missing or blank candidates", () => {
    expect(getSafeRedirectTo(null)).toBeNull();
    expect(getSafeRedirectTo(undefined)).toBeNull();
    expect(getSafeRedirectTo("")).toBeNull();
    expect(getSafeRedirectTo("   ")).toBeNull();
  });

  it("accepts same-origin relative paths", () => {
    expect(getSafeRedirectTo("/topos")).toBe("/topos");
    expect(getSafeRedirectTo("/")).toBe("/");
    expect(getSafeRedirectTo("/issues?status=open")).toBe("/issues?status=open");
  });

  it("rejects protocol-relative and backslash paths", () => {
    expect(getSafeRedirectTo("//evil.com/path")).toBeNull();
    expect(getSafeRedirectTo("/\\evil.com")).toBeNull();
  });

  it("accepts https URLs on the primary domain and its subdomains", () => {
    expect(getSafeRedirectTo("https://tabvar.org")).toBe("https://tabvar.org");
    expect(getSafeRedirectTo("https://tabvar.org/issues")).toBe("https://tabvar.org/issues");
    expect(getSafeRedirectTo("https://app.tabvar.org/issues?status=open")).toBe(
      "https://app.tabvar.org/issues?status=open"
    );
    expect(getSafeRedirectTo("https://deep.sub.tabvar.org/x")).toBe("https://deep.sub.tabvar.org/x");
  });

  it("rejects absolute URLs off the primary domain", () => {
    expect(getSafeRedirectTo("https://evil.com")).toBeNull();
    expect(getSafeRedirectTo("https://tabvar.org.evil.com/x")).toBeNull();
    expect(getSafeRedirectTo("https://eviltabvar.org/x")).toBeNull();
    expect(getSafeRedirectTo("https://tabvar.org@evil.com/")).toBeNull();
  });

  it("requires the https protocol for absolute URLs", () => {
    expect(getSafeRedirectTo("http://tabvar.org/issues")).toBeNull();
    expect(getSafeRedirectTo("tabvar.org/issues")).toBeNull();
    expect(getSafeRedirectTo("app.tabvar.org/issues")).toBeNull();
    expect(getSafeRedirectTo("javascript:alert(1)")).toBeNull();
  });

  it("rejects header-injection attempts", () => {
    expect(getSafeRedirectTo("/topos\r\nLocation: https://evil.com")).toBeNull();
  });
});
