import { describe, expect, it, vi } from "vitest";
import { loader } from "./api.discounts.$filename";
import {
  createContext,
  createGetRequest,
  createMockDb,
  createRouteArgs,
  createUser,
} from "~/test/helpers";
import * as authServer from "~/lib/auth.server";
import * as dbModule from "~/lib/db";

describe("api.discounts.$filename", () => {
  it("throws 401 if user is not authenticated", async () => {
    vi.spyOn(authServer, "getAuthenticator").mockReturnValue({
      isAuthenticated: vi.fn().mockResolvedValue(null),
    } as any);

    const context = createContext();
    const request = createGetRequest("https://example.com/api/discounts/code1.png");
    const args = createRouteArgs({ request, context, params: { filename: "code1.png" } });

    await expect(loader(args)).rejects.toSatisfy((res: Response) => {
      expect(res.status).toBe(401);
      return true;
    });
  });

  it("throws 403 if non-admin user is not the owner of the code", async () => {
    const user = createUser({ uid: "user-1", email: "user@example.com", role: "member" });
    vi.spyOn(authServer, "getAuthenticator").mockReturnValue({
      isAuthenticated: vi.fn().mockResolvedValue(user),
    } as any);

    const mockDb = createMockDb({
      select: [
        {
          executeTakeFirst: {
            claimedEmail: "other@example.com",
            claimedUid: "user-2",
          },
        },
      ],
    });
    vi.spyOn(dbModule, "getDB").mockReturnValue(mockDb as any);

    const context = createContext();
    const request = createGetRequest("https://example.com/api/discounts/code1.png");
    const args = createRouteArgs({ request, context, params: { filename: "code1.png" } });

    await expect(loader(args)).rejects.toSatisfy((res: Response) => {
      expect(res.status).toBe(403);
      return true;
    });
  });

  it("throws 404 if file does not exist in R2 bucket", async () => {
    const user = createUser({ uid: "user-1", email: "user@example.com", role: "member" });
    vi.spyOn(authServer, "getAuthenticator").mockReturnValue({
      isAuthenticated: vi.fn().mockResolvedValue(user),
    } as any);

    const mockDb = createMockDb({
      select: [
        {
          executeTakeFirst: {
            claimedEmail: "user@example.com",
            claimedUid: "user-1",
          },
        },
      ],
    });
    vi.spyOn(dbModule, "getDB").mockReturnValue(mockDb as any);

    const context = createContext();
    (context.cloudflare.env.TABVAR_MISC.get as any).mockResolvedValue(null);

    const request = createGetRequest("https://example.com/api/discounts/code1.png");
    const args = createRouteArgs({ request, context, params: { filename: "code1.png" } });

    await expect(loader(args)).rejects.toSatisfy((res: Response) => {
      expect(res.status).toBe(404);
      return true;
    });
  });

  it("returns 200 with image response for the owner", async () => {
    const user = createUser({ uid: "user-1", email: "user@example.com", role: "member" });
    vi.spyOn(authServer, "getAuthenticator").mockReturnValue({
      isAuthenticated: vi.fn().mockResolvedValue(user),
    } as any);

    const mockDb = createMockDb({
      select: [
        {
          executeTakeFirst: {
            claimedEmail: "user@example.com",
            claimedUid: "user-1",
          },
        },
      ],
    });
    vi.spyOn(dbModule, "getDB").mockReturnValue(mockDb as any);

    const mockBody = new ReadableStream();
    const mockR2Object = {
      body: mockBody,
      httpEtag: "etag-123",
      writeHttpMetadata: vi.fn((headers: Headers) => {
        headers.set("content-type", "image/png");
      }),
    };

    const context = createContext();
    (context.cloudflare.env.TABVAR_MISC.get as any).mockResolvedValue(mockR2Object);

    const request = createGetRequest("https://example.com/api/discounts/code1.png");
    const args = createRouteArgs({ request, context, params: { filename: "code1.png" } });

    const response = await loader(args);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="code1.png"');
    expect(response.headers.get("etag")).toBe("etag-123");
    expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
  });

  it("sets attachment Content-Disposition when download query param is present", async () => {
    const user = createUser({ uid: "user-1", email: "user@example.com", role: "member" });
    vi.spyOn(authServer, "getAuthenticator").mockReturnValue({
      isAuthenticated: vi.fn().mockResolvedValue(user),
    } as any);

    const mockDb = createMockDb({
      select: [
        {
          executeTakeFirst: {
            claimedEmail: "user@example.com",
            claimedUid: "user-1",
          },
        },
      ],
    });
    vi.spyOn(dbModule, "getDB").mockReturnValue(mockDb as any);

    const mockBody = new ReadableStream();
    const mockR2Object = {
      body: mockBody,
      httpEtag: "etag-123",
      writeHttpMetadata: vi.fn(), // No metadata written by R2
    };

    const context = createContext();
    (context.cloudflare.env.TABVAR_MISC.get as any).mockResolvedValue(mockR2Object);

    const request = createGetRequest("https://example.com/api/discounts/code1.png?download=1&filename=my-discount.png");
    const args = createRouteArgs({ request, context, params: { filename: "code1.png" } });

    const response = await loader(args);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="my-discount.png"');
  });
});
