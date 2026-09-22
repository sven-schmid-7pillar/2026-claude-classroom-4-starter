// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A2uiMessageListSchema, MessageProcessor } from "@a2ui/web_core/v0_9";
import { tryParseA2UIOperations } from "@ag-ui/a2ui-middleware";
import { validateA2UIComponents } from "@ag-ui/a2ui-toolkit";
import type { RequestContext } from "@mastra/core/request-context";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import { tutorCatalog } from "@/components/a2ui-catalog";
import { TUTOR_CATALOG_ID } from "@/lib/a2ui";
import * as schema from "@/lib/schema";
import { todos, user } from "@/lib/schema";
import {
  createTodoTools,
  type TodoProgress,
  tutorRequestContext,
} from "@/lib/todo-tools";

// A throwaway file, so the aggregate runs as real SQL against real rows.
let dir: string;
let db: ReturnType<typeof drizzle<typeof schema>>;
let tools: ReturnType<typeof createTodoTools>;

const ada = tutorRequestContext("user-ada");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-todo-progress-"));
  db = drizzle({ connection: { url: `file:${join(dir, "test.db")}` }, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  tools = createTodoTools(db);

  await db.insert(user).values([
    { id: "user-ada", name: "Ada", email: "ada@example.com" },
    { id: "user-grace", name: "Grace", email: "grace@example.com" },
  ]);
});

afterAll(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(todos);
});

type ProgressResult = {
  progress: TodoProgress;
  a2ui_operations: Record<string, unknown>[];
};

// Same cast as todo-tools.test.ts: runs the real executor, typed plainly.
const showProgress = (requestContext: RequestContext) =>
  (
    tools.showProgress.execute as (
      input: object,
      context: never,
    ) => Promise<ProgressResult>
  )({}, { requestContext } as never);

// One row per statement: `seq` is computed per statement (lib/schema.ts), so
// a multi-row insert would hand every row the same one.
async function seed(userId: string, done: boolean[]) {
  for (const [i, d] of done.entries()) {
    await db.insert(todos).values({ userId, title: `Item ${i}`, done: d });
  }
}

/** The operations, picked apart by kind. */
function unpack(operations: Record<string, unknown>[]) {
  const [create, components, data] = operations as [
    { createSurface: { surfaceId: string; catalogId: string } },
    {
      updateComponents: {
        surfaceId: string;
        components: Record<string, unknown>[];
      };
    },
    { updateDataModel: { surfaceId: string; path: string; value: unknown } },
  ];
  return {
    create: create.createSurface,
    components: components.updateComponents,
    data: data.updateDataModel,
  };
}

test("the operations are well-formed A2UI v0.9 messages", async () => {
  await seed("user-ada", [true, false]);

  const { a2ui_operations } = await showProgress(ada);

  // The spec's own message schema, as shipped with the renderer.
  expect(A2uiMessageListSchema.safeParse(a2ui_operations).success).toBe(true);
  expect(a2ui_operations.map((op) => Object.keys(op).sort())).toEqual([
    ["createSurface", "version"],
    ["updateComponents", "version"],
    ["updateDataModel", "version"],
  ]);

  const { create, components, data } = unpack(a2ui_operations);
  expect(components.surfaceId).toBe(create.surfaceId);
  expect(data.surfaceId).toBe(create.surfaceId);
  expect(data.path).toBe("/");
});

test("the runtime's middleware finds them in the result as AG-UI ships it", async () => {
  const result = await showProgress(ada);

  // @ag-ui/mastra puts `JSON.stringify(result)` on TOOL_CALL_RESULT, and this
  // is the parse the middleware runs on it before painting a surface.
  expect(tryParseA2UIOperations(JSON.stringify(result))).toEqual({
    operations: result.a2ui_operations,
  });
});

test("the tree resolves against the catalog the browser registers", async () => {
  await seed("user-ada", [true, false, false]);

  const { a2ui_operations } = await showProgress(ada);
  const { create, components, data } = unpack(a2ui_operations);

  expect(create.catalogId).toBe(TUTOR_CATALOG_ID);
  expect(tutorCatalog.id).toBe(TUTOR_CATALOG_ID);

  // Structure, a root, known component names, and every absolute binding
  // present in the data model.
  const catalog = {
    components: Object.fromEntries(
      [...tutorCatalog.components.keys()].map((name) => [name, {}]),
    ),
  };
  expect(
    validateA2UIComponents({
      components: components.components,
      data: data.value as Record<string, unknown>,
      catalog,
    }).errors,
  ).toEqual([]);

  // And the renderer's own processor accepts the whole sequence.
  const processor = new MessageProcessor([tutorCatalog]);
  expect(() =>
    processor.processMessages(a2ui_operations as never),
  ).not.toThrow();
});

test("the numbers match the rows, and only the caller's rows", async () => {
  await seed("user-ada", [true, true, true, false, false]);
  await seed("user-grace", [false, false, false, false]);

  const { progress, a2ui_operations } = await showProgress(ada);

  const rows = await db.query.todos.findMany({
    where: (t, { eq }) => eq(t.userId, "user-ada"),
  });
  const done = rows.filter((row) => row.done).length;
  const expected = {
    total: rows.length,
    done,
    open: rows.length - done,
    donePercent: 60,
    openPercent: 40,
  };

  expect(expected).toMatchObject({ total: 5, done: 3, open: 2 });
  expect(progress).toEqual(expected);
  expect(unpack(a2ui_operations).data.value).toEqual(expected);
});

test("the shares always add up to 100 despite rounding", async () => {
  await seed("user-ada", [true, false, false]);

  const { progress } = await showProgress(ada);

  expect(progress).toMatchObject({ donePercent: 33, openPercent: 67 });
});

test("an empty list reports zeros rather than dividing by zero", async () => {
  const { progress } = await showProgress(ada);

  expect(progress).toEqual({
    total: 0,
    done: 0,
    open: 0,
    donePercent: 0,
    openPercent: 0,
  });
});

test("the figures travel in the data model, never in the tree", async () => {
  await seed("user-ada", [true]);
  const first = unpack((await showProgress(ada)).a2ui_operations);

  await seed("user-ada", [false, false, false]);
  const second = unpack((await showProgress(ada)).a2ui_operations);

  expect(second.data.value).not.toEqual(first.data.value);
  expect(second.components).toEqual(first.components);
});
