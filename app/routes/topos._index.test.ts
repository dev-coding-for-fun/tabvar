import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createMockDb,
  createUser,
  getStatus,
  readJson,
  createRouteArgs,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getAuthenticator: vi.fn(),
  slugifyUnique: vi.fn(),
}));

vi.mock("mapbox-gl", () => ({
  default: {
    Map: vi.fn(),
    Marker: vi.fn(),
    Popup: vi.fn(),
  },
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/auth.server", () => ({
  getAuthenticator: mocks.getAuthenticator,
}));

vi.mock("~/lib/slug", () => ({
  slugifyUnique: mocks.slugifyUnique,
}));

import { action, loader } from "./topos._index";

describe("topos._index loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns crags and the optional current user", async () => {
    const crags = [{ id: 1, name: "A Crag", slug: "a-crag", latitude: null, longitude: null }];
    const user = createUser({ role: "admin" });
    const db = createMockDb({ select: [{ execute: crags }] });
    mocks.getDB.mockReturnValue(db);
    mocks.getAuthenticator.mockReturnValue({ isAuthenticated: vi.fn().mockResolvedValue(user) });

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/topos"),
      context: createContext(),
      params: {},
    }));

    expect(response).toEqual({ crags, user });
    expect(db.selectFrom).toHaveBeenCalledWith("crag");
  });
});

describe("topos._index action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthorized users", async () => {
    mocks.getAuthenticator.mockReturnValue({ isAuthenticated: vi.fn().mockResolvedValue(null) });

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos", { action: "create_crag" }),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(403);
    expect(await readJson(response)).toEqual({ error: "Unauthorized" });
  });

  it("validates crag creation", async () => {
    mocks.getAuthenticator.mockReturnValue({
      isAuthenticated: vi.fn().mockResolvedValue(createUser({ role: "admin" })),
    });

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos", { action: "create_crag" }),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(400);
    expect(await readJson(response)).toEqual({ error: "Name is required" });
  });

  it("creates a slugged crag", async () => {
    const db = createMockDb({
      insert: [
        {
          executeTakeFirst: {
            id: 5,
            name: "New Crag",
            slug: "new-crag",
            latitude: null,
            longitude: null,
          },
        },
      ],
    });
    mocks.getDB.mockReturnValue(db);
    mocks.slugifyUnique.mockResolvedValue("new-crag");
    mocks.getAuthenticator.mockReturnValue({
      isAuthenticated: vi.fn().mockResolvedValue(createUser({ role: "super" })),
    });

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos", {
        action: "create_crag",
        name: "New Crag",
      }),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(200);
    expect(await readJson(response)).toEqual({
      success: true,
      crag: {
        id: 5,
        name: "New Crag",
        slug: "new-crag",
        latitude: null,
        longitude: null,
      },
    });
    expect(mocks.slugifyUnique).toHaveBeenCalledWith(db, "New Crag");
  });

  it("updates crag coordinates", async () => {
    const db = createMockDb({ update: [{ execute: undefined }] });
    mocks.getDB.mockReturnValue(db);
    mocks.getAuthenticator.mockReturnValue({
      isAuthenticated: vi.fn().mockResolvedValue(createUser({ role: "admin" })),
    });

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/topos", {
        action: "update_position",
        cragId: "5",
        latitude: "51.1",
        longitude: "-114.2",
      }),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(200);
    expect(await readJson(response)).toEqual({ success: true });
    expect(db.__queries[0].set).toHaveBeenCalledWith({
      latitude: 51.1,
      longitude: -114.2,
    });
  });
});
