// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { recalculateAttachmentHashes } from "./attachment.server";
import { createContext, createMockDb } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

describe("recalculateAttachmentHashes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates and updates hashes and detects duplicates on same issue", async () => {
    const context = createContext();
    const env = (context as any).cloudflare.env;

    const mockBuffer1 = new TextEncoder().encode("photo content 1").buffer;
    const mockBuffer2 = new TextEncoder().encode("photo content 1").buffer; // duplicate of 1
    const mockBuffer3 = new TextEncoder().encode("topo photo").buffer;

    env.TABVAR_ISSUES_UPLOADS.get.mockImplementation(async (key: string) => {
      if (key === "photo1.jpg") return { arrayBuffer: async () => mockBuffer1, size: 15 };
      if (key === "photo2.jpg") return { arrayBuffer: async () => mockBuffer2, size: 15 };
      return null;
    });

    env.TABVAR_TOPOS.get.mockImplementation(async (key: string) => {
      if (key === "topo.jpg") return { arrayBuffer: async () => mockBuffer3, size: 10 };
      return null;
    });

    const db = createMockDb({
      select: [
        {
          // issue_attachment rows (two rows on same issue with identical contents)
          execute: [
            { id: 1, issue_id: 10, name: "photo1.jpg", url: "https://issues/photo1.jpg", file_hash: null, file_size: null },
            { id: 2, issue_id: 10, name: "photo2.jpg", url: "https://issues/photo2.jpg", file_hash: null, file_size: null },
          ],
        },
        {
          // topo_attachment rows
          execute: [
            { id: 100, name: "topo.jpg", url: "https://topos/topo.jpg", file_hash: null, file_size: null },
          ],
        },
      ],
      update: [
        { execute: undefined },
        { execute: undefined },
        { execute: undefined },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const stats = await recalculateAttachmentHashes(context);

    expect(stats.issues.total).toBe(2);
    expect(stats.issues.updated).toBe(2);
    expect(stats.issues.duplicates).toBe(1);
    expect(stats.duplicates).toHaveLength(1);
    expect(stats.duplicates[0].issueId).toBe(10);
    expect(stats.duplicates[0].attachmentIds).toEqual([1, 2]);

    expect(stats.topos.total).toBe(1);
    expect(stats.topos.updated).toBe(1);
    expect(stats.topos.errors).toBe(0);

    expect(db.updateTable).toHaveBeenCalledWith("issue_attachment");
    expect(db.updateTable).toHaveBeenCalledWith("topo_attachment");
  });

  it("handles missing R2 objects by reporting errors", async () => {
    const context = createContext();
    const env = (context as any).cloudflare.env;
    env.TABVAR_ISSUES_UPLOADS.get.mockResolvedValue(null);
    env.TABVAR_TOPOS.get.mockResolvedValue(null);

    const db = createMockDb({
      select: [
        {
          execute: [
            { id: 1, issue_id: 10, name: "missing.jpg", url: "https://issues/missing.jpg", file_hash: null, file_size: null },
          ],
        },
        { execute: [] },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const stats = await recalculateAttachmentHashes(context);

    expect(stats.issues.errors).toBe(1);
    expect(stats.errors).toHaveLength(1);
    expect(stats.errors[0].error).toContain("Object not found in R2");
  });
});
