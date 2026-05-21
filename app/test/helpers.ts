import type { ActionFunctionArgs, AppLoadContext, LoaderFunctionArgs } from "react-router";
import { vi, type Mock } from "vitest";
import type { User } from "~/lib/models";

type QueryResult = {
  execute?: unknown;
  executeTakeFirst?: unknown;
  executeTakeFirstOrThrow?: unknown;
};

type QueryMethod =
  | "distinct"
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

export function createContext(env: Partial<Env> = {}): AppLoadContext {
  return {
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
        ...env,
      },
    },
  } as unknown as AppLoadContext;
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
  return args as ActionFunctionArgs & LoaderFunctionArgs;
}

export async function readJson(value: unknown) {
  if (value instanceof Response) {
    return value.json();
  }
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "DataWithResponseInit" &&
    "data" in value
  ) {
    return value.data;
  }

  return value;
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

  return {
    selectFrom: vi.fn(() => makeQuery(results.select)),
    insertInto: vi.fn(() => makeQuery(results.insert)),
    updateTable: vi.fn(() => makeQuery(results.update)),
    deleteFrom: vi.fn(() => makeQuery(results.delete)),
    __queries: queries,
  };
}
