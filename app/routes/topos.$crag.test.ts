import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createMockDb,
  createUser,
  createRouteArgs,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getAuthenticator: vi.fn(),
  requireUser: vi.fn(),
  loadCragById: vi.fn(),
  loadCragBySlug: vi.fn(),
  deleteCrag: vi.fn(),
  createSector: vi.fn(),
  updateSectorName: vi.fn(),
  deleteSector: vi.fn(),
  updateSectorNotes: vi.fn(),
  createRoute: vi.fn(),
  updateRoute: vi.fn(),
  updateRouteOrder: vi.fn(),
  deleteRoute: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/auth.server", () => ({
  getAuthenticator: mocks.getAuthenticator,
  requireUser: mocks.requireUser,
}));

vi.mock("~/lib/crag.server", () => ({
  loadCragById: mocks.loadCragById,
  loadCragBySlug: mocks.loadCragBySlug,
  deleteCrag: mocks.deleteCrag,
}));

vi.mock("~/lib/sector.server", () => ({
  createSector: mocks.createSector,
  updateSectorName: mocks.updateSectorName,
  deleteSector: mocks.deleteSector,
  updateSectorNotes: mocks.updateSectorNotes,
}));

vi.mock("~/lib/route.server", () => ({
  createRoute: mocks.createRoute,
  updateRoute: mocks.updateRoute,
  updateRouteOrder: mocks.updateRouteOrder,
  deleteRoute: mocks.deleteRoute,
}));

vi.mock("~/components/SectorCard", () => ({
  SectorCard: () => null,
}));

vi.mock("~/components/TopoGallery", () => ({
  TopoGallery: () => null,
}));

vi.mock("~/components/RichTextViewer", () => ({
  RichTextViewer: () => null,
}));

vi.mock("~/components/ConfiguredRichTextEditor", () => ({
  ConfiguredRichTextEditor: () => null,
}));

import { action, loader } from "./topos.$crag";

const crag = {
  id: 1,
  name: "Test Crag",
  slug: "test-crag",
  sectors: [
    { id: 2, name: "Main", routes: [] },
    { id: 3, name: "Untitled Sector 2", routes: [] },
  ],
};

describe("topos.$crag loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticator.mockReturnValue({ isAuthenticated: vi.fn().mockResolvedValue(null) });
  });

  it("throws 400 without a crag identifier", async () => {
    await expect(
      loader(createRouteArgs({
        request: createGetRequest("https://example.com/topos/"),
        context: createContext(),
        params: {},
      }))
    ).rejects.toMatchObject({ status: 400 });
  });

  it("redirects numeric crag ids to slugs", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: { slug: "test-crag" } }] });
    mocks.getDB.mockReturnValue(db);

    await expect(
      loader(createRouteArgs({
        request: createGetRequest("https://example.com/topos/1?foo=bar"),
        context: createContext(),
        params: { crag: "1" },
      }))
    ).rejects.toMatchObject({ status: 301 });
  });

  it("loads a crag by slug", async () => {
    mocks.loadCragBySlug.mockResolvedValue(crag);
    const user = createUser({ role: "member" });
    mocks.getAuthenticator.mockReturnValue({ isAuthenticated: vi.fn().mockResolvedValue(user) });

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/topos/test-crag"),
      context: createContext(),
      params: { crag: "test-crag" },
    }));

    expect(response).toMatchObject({
      crag: { id: 1, name: "Test Crag" },
      user,
    });
    expect(mocks.loadCragBySlug).toHaveBeenCalledWith(expect.anything(), "test-crag");
  });

  it("converts load failures to a 404 response", async () => {
    mocks.loadCragBySlug.mockRejectedValue(new Error("not found"));

    await expect(
      loader(createRouteArgs({
        request: createGetRequest("https://example.com/topos/missing"),
        context: createContext(),
        params: { crag: "missing" },
      }))
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("topos.$crag action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));
  });

  it("returns a permission error for non-editor users", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos/test-crag", {
        action: "create_sector",
        cragId: "1",
      }),
      context: createContext(),
      params: { crag: "test-crag" },
    }));

    expect(response).toEqual({
      error: "You do not have the required permissions to access this page.",
    });
  });

  it("delegates sector management actions", async () => {
    mocks.createSector.mockResolvedValue({ success: true, sector: { id: 1 } });
    mocks.updateSectorName.mockResolvedValue({ success: true });
    mocks.deleteSector.mockResolvedValue({ success: true });

    await expect(
      action(createRouteArgs({
        request: createFormRequest("https://example.com/topos/test-crag", {
          action: "create_sector",
          cragId: "1",
          name: "New Sector",
        }),
        context: createContext(),
        params: {},
      }))
    ).resolves.toEqual({ success: true, sector: { id: 1 } });
    expect(mocks.createSector).toHaveBeenCalledWith(expect.anything(), 1, "New Sector");

    await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos/test-crag", {
        action: "update_sector_name",
        sectorId: "2",
        name: "Renamed",
      }),
      context: createContext(),
      params: {},
    }));
    expect(mocks.updateSectorName).toHaveBeenCalledWith(expect.anything(), 2, "Renamed");

    await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos/test-crag", {
        action: "delete_sector",
        sectorId: "2",
      }),
      context: createContext(),
      params: {},
    }));
    expect(mocks.deleteSector).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it("delegates route management actions", async () => {
    mocks.createRoute.mockResolvedValue({ success: true });
    mocks.updateRoute.mockResolvedValue({ success: true });
    mocks.deleteRoute.mockResolvedValue({ success: true });

    await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos/test-crag", {
        action: "create_route",
        sectorId: "2",
        name: "New Route",
        gradeYds: "5.10a",
      }),
      context: createContext(),
      params: {},
    }));
    expect(mocks.createRoute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sectorId: 2, name: "New Route", gradeYds: "5.10a" })
    );

    await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos/test-crag", {
        action: "update_route",
        routeId: "3",
        name: "Updated Route",
      }),
      context: createContext(),
      params: {},
    }));
    expect(mocks.updateRoute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 3, name: "Updated Route" })
    );

    await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos/test-crag", {
        action: "delete_route",
        routeId: "3",
      }),
      context: createContext(),
      params: {},
    }));
    expect(mocks.deleteRoute).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it("updates crag fields and deletes crags", async () => {
    const db = createMockDb({ update: [{ execute: undefined }] });
    mocks.getDB.mockReturnValue(db);
    mocks.deleteCrag.mockResolvedValue({ success: true });

    await expect(
      action(createRouteArgs({
        request: createFormRequest("https://example.com/topos/test-crag", {
          action: "update_crag_name",
          cragId: "1",
          name: "Renamed Crag",
        }),
        context: createContext(),
        params: {},
      }))
    ).resolves.toEqual({ success: true });
    expect(db.updateTable).toHaveBeenCalledWith("crag");

    await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos/test-crag", {
        action: "delete_crag",
        cragId: "1",
      }),
      context: createContext(),
      params: {},
    }));
    expect(mocks.deleteCrag).toHaveBeenCalledWith(expect.anything(), 1);
  });
});
