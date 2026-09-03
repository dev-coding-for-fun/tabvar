---
name: test-writing
description: >-
  Use this skill when creating or updating unit or integration tests for loaders,
  actions, server utilities, or components in this repository using Vitest.
---

# Vitest Testing Guide & Helpers Cheatsheet

This repository uses **Vitest** with `happy-dom` for testing loaders, actions, utilities, and components. Tests run fast (~4s for the full suite).

---

## 1. Golden Rule: Always Use `app/test/helpers.ts`

Do not hand-roll custom Kysely mocks, mock servers, or complex mocks. Import the established utilities from `~/test/helpers`:

```ts
import {
  createRouteArgs,
  createContext,
  createGetRequest,
  createFormRequest,
  createMockDb,
  readJson,
  createUser,
} from "~/test/helpers";
```

---

## 2. Testing Route Loaders

Here is the standard pattern for testing a route loader:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRouteArgs,
  createContext,
  createGetRequest,
  createMockDb,
  readJson,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import { loader } from "./my-route";

describe("my-route loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns items from the database", async () => {
    const mockItems = [{ id: 1, name: "First Item" }];
    const db = createMockDb({
      select: [{ execute: mockItems }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await loader(
      createRouteArgs({
        request: createGetRequest("https://example.com/my-route"),
        context: createContext(),
        params: {},
      })
    );

    const data = await readJson(response);
    expect(data.items).toEqual(mockItems);
    expect(db.selectFrom).toHaveBeenCalledWith("issue");
  });
});
```

---

## 3. Testing Route Actions (Form & JSON)

### Form Actions:
```ts
const response = await action(
  createRouteArgs({
    request: createFormRequest("https://example.com/my-route", {
      title: "New Issue",
      status: "Reported",
    }),
    context: createContext(),
    params: {},
  })
);
const body = await readJson(response);
```

### JSON Actions:
```ts
const response = await action(
  createRouteArgs({
    request: new Request("https://example.com/api/v1/endpoint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    }),
    context: createContext(),
    params: {},
  })
);
const body = await readJson(response);
```

---

## 4. `createMockDb` Mocking Methods

`createMockDb` simulates Kysely's fluent query builder:
- **`select`**: Array of query return configurations (e.g. `{ execute: [...] }`, `{ executeTakeFirst: row }`, `{ executeTakeFirstOrThrow: row }`).
- **`insert`**: Array of insert return values (e.g. `{ execute: [] }`).
- **`update`**: Array of update return values.
- **`delete`**: Array of delete return values.

Each query step is recorded in `db.__queries` for assertions:
```ts
expect(db.__queries[0].where).toHaveBeenCalledWith("status", "=", "Reported");
```

---

## 5. Running Tests

- **Run all tests**:
  ```bash
  npm test
  ```
- **Run a single test file**:
  ```bash
  npx vitest run app/routes/api.issues.test.ts
  ```
- **Run in watch mode**:
  ```bash
  npm run test:watch
  ```
- **Verify TypeScript types across the repo**:
  ```bash
  npm run typecheck
  ```
