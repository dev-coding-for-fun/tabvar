import { type ActionFunctionArgs, type LoaderFunctionArgs, RouterContextProvider } from "react-router";
import type { AppLoadContext } from "~/../load-context";
import { vi, type Mock } from "vitest";
import type { User } from "~/lib/models";
import type { SubmissionObject } from "~/lib/submission.server";

type QueryResult = {
  execute?: unknown;
  executeTakeFirst?: unknown;
  executeTakeFirstOrThrow?: unknown;
};

type QueryMethod =
  | "distinct"
  | "groupBy"
  | "innerJoin"
  | "leftJoin"
  | "limit"
  | "orderBy"
  | "returning"
  | "returningAll"
  | "select"
  | "selectAll"
  | "set"
  | "unionAll"
  | "values"
  | "where";

export type FluentQuery = Record<QueryMethod, Mock> & {
  $if: Mock;
  execute: Mock;
  executeTakeFirst: Mock;
  executeTakeFirstOrThrow: Mock;
};

export type MockDb = {
  selectFrom: Mock;
  insertInto: Mock;
  updateTable: Mock;
  deleteFrom: Mock;
  transaction: Mock;
  __queries: FluentQuery[];
};

export function createUser(overrides: Partial<User> = {}): User {
  return {
    uid: "user-1",
    displayName: "Test User",
    email: "user@example.com",
    emailVerified: true,
    providerId: "google",
    role: "member",
    ...overrides,
  };
}

/**
 * A minimal image file with real headers, so it can be measured: a PNG for
 * `image/png`, otherwise a JPEG, optionally with an EXIF orientation.
 */
export function createImageFile(
  name: string,
  { type = "image/jpeg", width = 640, height = 480, orientation }: {
    type?: string;
    width?: number;
    height?: number;
    orientation?: number;
  } = {},
): File {
  const u16 = (value: number) => [value >> 8, value & 0xff];
  const u32 = (value: number) => [...u16(value >>> 16), ...u16(value & 0xffff)];
  let bytes: number[];
  if (type === "image/png") {
    bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height), 8, 2, 0, 0, 0, ...u32(0)];
  } else {
    // An EXIF APP1 segment when there's an orientation, else a plain JFIF APP0.
    const header = orientation === undefined
      ? [0xff, 0xe0, ...u16(16), 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, ...u16(1), ...u16(1), 0, 0]
      : (() => {
        // Big-endian TIFF with one IFD entry: tag 274 (orientation), SHORT, count 1.
        const tiff = [0x4d, 0x4d, 0, 0x2a, ...u32(8), ...u16(1), ...u16(274), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
        const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
        return [0xff, 0xe1, ...u16(exif.length + 2), ...exif];
      })();
    const startOfFrame = [8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    bytes = [
      0xff, 0xd8,
      ...header,
      0xff, 0xc0, ...u16(startOfFrame.length + 2), ...startOfFrame,
      0xff, 0xd9,
    ];
  }
  return new File([new Uint8Array(bytes)], name, { type });
}

let nextSubmissionObjectId = 1;

/** A pending submission object: a new object with a `ref`, or an edit with a `targetId`. */
export function createSubmissionObject(
  overrides: Partial<SubmissionObject> & Pick<SubmissionObject, "entity" | "fields">,
): SubmissionObject {
  return {
    id: nextSubmissionObjectId++,
    uid: "submitter",
    source: "topobuilder",
    ref: null,
    targetId: null,
    baseUpdatedAt: null,
    state: "pending",
    error: null,
    receivedAt: "2026-10-01 00:00:00",
    decidedAt: null,
    updatedAt: "2026-10-01 00:00:00",
    ...overrides,
  };
}

export function createMockR2Bucket() {
  return {
    put: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    head: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
  };
}

/** An R2 bucket that keeps objects in memory, so tests can check what's stored. */
export function createMemoryR2Bucket() {
  const objects = new Map<string, ArrayBuffer>();
  return {
    objects,
    head: vi.fn(async (key: string) => (objects.has(key) ? { key } : null)),
    put: vi.fn(async (key: string, value: ArrayBuffer) => {
      objects.set(key, value);
      return { key };
    }),
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
  };
}

export function createMockEmail() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  };
}

export function createContext(
  env: Partial<Omit<Env, "TOPOBUILDER_RETURN_TO_ALLOWLIST">> & {
    TOPOBUILDER_RETURN_TO_ALLOWLIST?: string;
  } & Record<string, unknown> = {}
): AppLoadContext {
  const context = new RouterContextProvider();
  Object.assign(context, {
    cloudflare: {
      env: {
        COOKIE_SECRET: "test-secret",
        COOKIE_DOMAIN: undefined,
        ENVIRONMENT: "test",
        GOOGLE_CLIENT_ID: "google-client",
        GOOGLE_CLIENT_SECRET: "google-secret",
        BASE_URL: "https://example.com",
        ISSUES_BUCKET_NAME: "issues",
        ISSUES_BUCKET_DOMAIN: "https://issues.example.com",
        TOPOS_BUCKET_NAME: "topos",
        TOPOS_BUCKET_DOMAIN: "https://topos.example.com",
        MISC_BUCKET_NAME: "misc",
        MISC_BUCKET_DOMAIN: "https://misc.files.tabvar.org",
        TABVAR_ISSUES_UPLOADS: createMockR2Bucket() as unknown as R2Bucket,
        TABVAR_TOPOS: createMockR2Bucket() as unknown as R2Bucket,
        TABVAR_MISC: createMockR2Bucket() as unknown as R2Bucket,
        EMAIL: createMockEmail() as unknown as SendEmail,
        AUTH_FROM_EMAIL: "auth@tabvar.org",
        ...env,
      },
    },
  });
  return context;
}

export function createGetRequest(url = "https://example.com/") {
  return new Request(url, { method: "GET" });
}

export function createFormRequest(
  url: string,
  fields: Record<string, string | Blob | Array<string | Blob>>
) {
  const formData = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      formData.append(key, item);
    }
  }

  return new Request(url, {
    method: "POST",
    body: formData,
  });
}

export function createRouteArgs(args: {
  request: Request;
  context: AppLoadContext;
  params: Record<string, string | undefined>;
}): ActionFunctionArgs & LoaderFunctionArgs {
  return {
    ...args,
    url: new URL(args.request.url),
    pattern: "",
  } as ActionFunctionArgs & LoaderFunctionArgs;
}

export async function readJson<T = any>(value: unknown): Promise<T> {
  if (value instanceof Response) {
    return (await value.json()) as T;
  }
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "DataWithResponseInit" &&
    "data" in value
  ) {
    return (value as { data: T }).data;
  }

  return value as T;
}

export function getStatus(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "DataWithResponseInit" &&
    "init" in value
  ) {
    const init = value.init;
    return init && typeof init === "object" && "status" in init && typeof init.status === "number"
      ? init.status
      : 200;
  }

  return value instanceof Response ? value.status : 200;
}

export function createFluentQuery(result: QueryResult = {}): FluentQuery {
  const query = {} as FluentQuery;
  const methods: QueryMethod[] = [
    "distinct",
    "groupBy",
    "innerJoin",
    "leftJoin",
    "limit",
    "orderBy",
    "returning",
    "returningAll",
    "select",
    "selectAll",
    "set",
    "unionAll",
    "values",
    "where",
  ];

  for (const method of methods) {
    query[method] = vi.fn(() => query);
  }

  query.$if = vi.fn((condition: boolean, callback: (qb: FluentQuery) => FluentQuery) =>
    condition ? callback(query) : query
  );
  query.execute = vi.fn(async () => {
    if (result.execute instanceof Error) {
      throw result.execute;
    }
    return result.execute ?? [];
  });
  query.executeTakeFirst = vi.fn(async () => result.executeTakeFirst);
  query.executeTakeFirstOrThrow = vi.fn(async () => {
    if (result.executeTakeFirstOrThrow instanceof Error) {
      throw result.executeTakeFirstOrThrow;
    }
    return result.executeTakeFirstOrThrow;
  });

  return query;
}

function takeNext(queue: QueryResult[] | undefined) {
  return queue?.shift() ?? {};
}

export function createMockDb(results: {
  select?: QueryResult[];
  insert?: QueryResult[];
  update?: QueryResult[];
  delete?: QueryResult[];
} = {}): MockDb {
  const queries: FluentQuery[] = [];
  const makeQuery = (queue: QueryResult[] | undefined) => {
    const query = createFluentQuery(takeNext(queue));
    queries.push(query);
    return query;
  };

  const db: MockDb = {
    selectFrom: vi.fn(() => makeQuery(results.select)),
    insertInto: vi.fn(() => makeQuery(results.insert)),
    updateTable: vi.fn(() => makeQuery(results.update)),
    deleteFrom: vi.fn(() => makeQuery(results.delete)),
    transaction: vi.fn(() => ({
      execute: vi.fn(async (callback: (trx: MockDb) => Promise<unknown>) => callback(db)),
    })),
    __queries: queries,
  };
  return db;
}
