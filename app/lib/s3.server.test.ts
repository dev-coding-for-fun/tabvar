import { describe, it, expect, vi } from "vitest";
import { uploadFileToR2, deleteFromR2, renameInR2, getR2Bucket, calculateFileHash } from "./s3.server";
import { createContext } from "~/test/helpers";

describe("s3.server (R2 native binding)", () => {
  it("resolves bucket by name or binding name", () => {
    const context = createContext();
    const env = (context as any).cloudflare.env;

    expect(getR2Bucket(context, "issues")).toBe(env.TABVAR_ISSUES_UPLOADS);
    expect(getR2Bucket(context, "tabvar-issues-uploads")).toBe(env.TABVAR_ISSUES_UPLOADS);
    expect(getR2Bucket(context, "TABVAR_ISSUES_UPLOADS")).toBe(env.TABVAR_ISSUES_UPLOADS);

    expect(getR2Bucket(context, "topos")).toBe(env.TABVAR_TOPOS);
    expect(getR2Bucket(context, "tabvar-topos")).toBe(env.TABVAR_TOPOS);
    expect(getR2Bucket(context, "TABVAR_TOPOS")).toBe(env.TABVAR_TOPOS);
  });

  it("throws for unrecognized bucket name", () => {
    const context = createContext();
    expect(() => getR2Bucket(context, "non-existent-bucket")).toThrow(
      "Could not resolve R2 bucket binding for 'non-existent-bucket'"
    );
  });

  it("uploads file to R2 bucket using native put()", () => {
    return new Promise<void>((done) => {
      const context = createContext();
      const env = (context as any).cloudflare.env;
      const file = new File(["test content"], "photo.jpg", { type: "image/jpeg" });

      uploadFileToR2(context, file, "issues", "https://cdn.example.com", {
        keyPrefix: "attachments/123",
      }).then((result) => {
        expect(result.url).toBe("https://cdn.example.com/attachments/123/photo.jpg");
        expect(result.name).toBe("attachments/123/photo.jpg");
        expect(result.type).toBe("image/jpeg");

        expect(env.TABVAR_ISSUES_UPLOADS.put).toHaveBeenCalledWith(
          "attachments/123/photo.jpg",
          expect.any(ArrayBuffer),
          {
            httpMetadata: {
              contentType: "image/jpeg",
            },
          }
        );
        done();
      });
    });
  });

  it("handles GPX files with special content-type", async () => {
    const context = createContext();
    const env = (context as any).cloudflare.env;
    const file = new File(["<gpx></gpx>"], "route.gpx", { type: "application/octet-stream" });

    const result = await uploadFileToR2(context, file, "topos", "https://topos.example.com");
    expect(result.type).toBe("application/gpx+xml");
    expect(env.TABVAR_TOPOS.put).toHaveBeenCalledWith(
      "route.gpx",
      expect.any(ArrayBuffer),
      {
        httpMetadata: {
          contentType: "application/gpx+xml",
        },
      }
    );
  });

  it("deletes file from R2 using native delete()", async () => {
    const context = createContext();
    const env = (context as any).cloudflare.env;

    await deleteFromR2(context, "issues", "attachments/123/photo.jpg");
    expect(env.TABVAR_ISSUES_UPLOADS.delete).toHaveBeenCalledWith("attachments/123/photo.jpg");
  });

  it("renames file by get() -> put() -> delete()", async () => {
    const context = createContext();
    const env = (context as any).cloudflare.env;

    const mockBody = new ReadableStream();
    const mockHttpMetadata = { contentType: "image/png" };
    const mockCustomMetadata = { author: "dev" };

    env.TABVAR_TOPOS.get.mockResolvedValueOnce({
      body: mockBody,
      httpMetadata: mockHttpMetadata,
      customMetadata: mockCustomMetadata,
    });

    await renameInR2(context, "topos", "old%20name.png", "new name.png");

    expect(env.TABVAR_TOPOS.get).toHaveBeenCalledWith("old%20name.png");
    expect(env.TABVAR_TOPOS.put).toHaveBeenCalledWith("new name.png", mockBody, {
      httpMetadata: mockHttpMetadata,
      customMetadata: mockCustomMetadata,
    });
    expect(env.TABVAR_TOPOS.delete).toHaveBeenCalledWith("old%20name.png");
  });

  it("throws when renaming non-existent object", async () => {
    const context = createContext();
    const env = (context as any).cloudflare.env;
    env.TABVAR_TOPOS.get.mockResolvedValueOnce(null);

    await expect(renameInR2(context, "topos", "missing.png", "target.png")).rejects.toThrow(
      "Object 'missing.png' not found in R2 bucket 'topos'"
    );
  });

  it("calculates accurate SHA-1 hash for bytes", async () => {
    // SHA-1 for "test content" is 1eebdf4fdc9fc7bf283031b93f9aef3338de9052
    const encoder = new TextEncoder();
    const hash = await calculateFileHash(encoder.encode("test content").buffer as ArrayBuffer);
    expect(hash).toBe("1eebdf4fdc9fc7bf283031b93f9aef3338de9052");
  });

  it("uploads file using content hash as key when useContentHash is true", async () => {
    const context = createContext();
    const env = (context as any).cloudflare.env;
    const file = new File(["test content"], "photo.jpg", { type: "image/jpeg" });

    const result = await uploadFileToR2(context, file, "issues", "https://issues.example.com", {
      keyPrefix: "issues",
      useContentHash: true,
    });

    const expectedHash = "1eebdf4fdc9fc7bf283031b93f9aef3338de9052";
    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(12);
    expect(result.name).toBe(`issues/${expectedHash}.jpg`);
    expect(result.url).toBe(`https://issues.example.com/issues/${expectedHash}.jpg`);
    expect(env.TABVAR_ISSUES_UPLOADS.head).toHaveBeenCalledWith(`issues/${expectedHash}.jpg`);
    expect(env.TABVAR_ISSUES_UPLOADS.put).toHaveBeenCalledWith(
      `issues/${expectedHash}.jpg`,
      expect.any(ArrayBuffer),
      expect.anything(),
    );
  });

  it("skips R2 put() when object already exists and useContentHash is true", async () => {
    const context = createContext();
    const env = (context as any).cloudflare.env;
    const file = new File(["test content"], "photo.jpg", { type: "image/jpeg" });

    const expectedHash = "1eebdf4fdc9fc7bf283031b93f9aef3338de9052";
    env.TABVAR_ISSUES_UPLOADS.head.mockResolvedValueOnce({ size: 12 });

    const result = await uploadFileToR2(context, file, "issues", "https://issues.example.com", {
      keyPrefix: "issues",
      useContentHash: true,
    });

    expect(result.hash).toBe(expectedHash);
    expect(env.TABVAR_ISSUES_UPLOADS.head).toHaveBeenCalledWith(`issues/${expectedHash}.jpg`);
    expect(env.TABVAR_ISSUES_UPLOADS.put).not.toHaveBeenCalled();
  });
});
