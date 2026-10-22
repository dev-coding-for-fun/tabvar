import { describe, expect, it } from "vitest";
import { createGetRequest } from "~/test/helpers";
import { getLegacyTopoResponse } from "./workerRouting.server";

describe("legacy topo retirement", () => {
  it.each(["http", "https"])("redirects the %s homepage to the active index", (scheme) => {
    const response = getLegacyTopoResponse(createGetRequest(`${scheme}://topos.tabvar.org/?page=2`));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("Location")).toBe("https://app.tabvar.org/topos");
  });

  it.each(["/node/147", "/node/27", "/sites/default/files/missing.pdf", "/favicon.ico"])("returns a generic 410 for %s", async (path) => {
    const response = getLegacyTopoResponse(createGetRequest(`https://topos.tabvar.org${path}?private=secret`));
    expect(response?.status).toBe(410);
    expect(response?.headers.has("Location")).toBe(false);
    const html = await response!.text();
    expect(html).toContain('href="https://app.tabvar.org/topos"');
    expect(html).not.toContain(path);
    expect(html).not.toContain("secret");
  });

  it("handles HEAD without a response body", async () => {
    const response = getLegacyTopoResponse(new Request("https://topos.tabvar.org/node/147", { method: "HEAD" }));
    expect(response?.status).toBe(410);
    expect(await response!.text()).toBe("");
  });

  it("retires old writes without redirecting them into the active app", () => {
    const response = getLegacyTopoResponse(new Request("https://topos.tabvar.org/api/issues", { method: "POST", body: "old-data" }));
    expect(response?.status).toBe(410);
    expect(response?.headers.has("Location")).toBe(false);
  });

  it("leaves the active app to its existing handler", () => {
    expect(getLegacyTopoResponse(createGetRequest("https://app.tabvar.org/topos"))).toBeUndefined();
  });
});
