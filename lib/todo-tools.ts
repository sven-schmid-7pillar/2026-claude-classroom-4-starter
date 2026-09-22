import {
  A2UI_OPERATIONS_KEY,
  createSurface,
  updateComponents,
  updateDataModel,
} from "@ag-ui/a2ui-toolkit";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { Todo } from "ai-tutor-api-contract";
import { and, asc, eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/libsql/node";
import { z } from "zod";
import { TUTOR_CATALOG_ID } from "@/lib/a2ui";
import type * as schema from "@/lib/schema";
import { todos } from "@/lib/schema";

/**
 * The one key the tools read out of Mastra's `RequestContext`, and the only
 * way a user id reaches them. The route sets it from the verified session (see
 * app/api/copilotkit/[...all]/route.ts); the AG-UI bridge writes only the
 * separate "ag-ui" key, so nothing the model or the browser sends can reach it.
 * Declaring it as a schema makes an execution without one fail before the
 * statement runs rather than fall through to some default.
 */
const requestContextSchema = z.object({ userId: z.string().min(1) });

/**
 * Builds a context the tools accept; the route and the tests share it. Left on
 * the plain `RequestContext` type because that is what `getLocalAgent` takes.
 */
export function tutorRequestContext(userId: string) {
  const requestContext = new RequestContext();
  requestContext.set("userId", userId);
  return requestContext;
}

// Same shape as lib/db.ts builds, so the app hands over its own connection and
// a test hands over one on a throwaway file.
export type TodoDb = ReturnType<typeof drizzle<typeof schema>>;

const todoColumns = { id: todos.id, title: todos.title, done: todos.done };

/**
 * The one read of the list, shared by the `listTodos` tool, the page, and
 * /api/todos so all of them show the same thing, oldest item first by `seq`
 * (see lib/schema.ts). `query` is a case-insensitive
 * substring match; `instr` rather than LIKE, so `%` and `_` match literally.
 */
export function listTodosFor(db: TodoDb, userId: string, query?: string) {
  const needle = query?.trim();
  return db
    .select(todoColumns)
    .from(todos)
    .where(
      and(
        eq(todos.userId, userId),
        needle
          ? sql`instr(lower(${todos.title}), lower(${needle})) > 0`
          : undefined,
      ),
    )
    .orderBy(asc(todos.seq));
}

/** The one insert, shared by the `addTodo` tool and `POST /api/todos`. */
export async function addTodoFor(db: TodoDb, userId: string, title: string) {
  const [row] = await db
    .insert(todos)
    .values({ userId, title: title.trim() })
    .returning(todoColumns);
  return row;
}

/**
 * The one update, shared by the `setTodoDone` tool and `PATCH /api/todos/:id`.
 * Filtered by `userId` as well as `id`, so another user's item comes back as
 * `null` — indistinguishable from an id that does not exist.
 */
export async function setTodoDoneFor(
  db: TodoDb,
  userId: string,
  id: string,
  done: boolean,
) {
  const [row] = await db
    .update(todos)
    .set({ done })
    .where(and(eq(todos.id, id), eq(todos.userId, userId)))
    .returning(todoColumns);
  return row ?? null;
}

export type TodoItem = Awaited<ReturnType<typeof listTodosFor>>[number];

/**
 * The counts behind the progress card, taken in one aggregate so the model
 * never does the arithmetic. The shares are whole percentages and the open
 * share is the remainder of the done one, so on a non-empty list the two
 * always add up to 100 instead of rounding to 99 or 101.
 */
export async function todoProgressFor(db: TodoDb, userId: string) {
  const [{ total, done }] = await db
    .select({
      total: sql`count(*)`.mapWith(Number),
      done: sql`coalesce(sum(${todos.done}), 0)`.mapWith(Number),
    })
    .from(todos)
    .where(eq(todos.userId, userId));

  const donePercent = total === 0 ? 0 : Math.round((done / total) * 100);
  return {
    total,
    done,
    open: total - done,
    donePercent,
    openPercent: total === 0 ? 0 : 100 - donePercent,
  };
}

export type TodoProgress = Awaited<ReturnType<typeof todoProgressFor>>;

const PROGRESS_SURFACE_ID = "todo-progress";

/**
 * The progress card's component tree in A2UI v0.9's flat form, authored once
 * here. It carries no figures: every number is a binding into the surface's
 * data model — a `path`, or a `formatString` that interpolates paths — so the
 * tree is fixed and only `updateDataModel` changes per call. `ProgressBar` and
 * the square `Card` come from the tutor's catalog (components/a2ui-catalog.tsx);
 * the rest are A2UI's basic components.
 */
const progressCard = [
  { id: "root", component: "Card", child: "body" },
  {
    id: "body",
    component: "Column",
    children: ["title", "bar", "counts", "total"],
  },
  { id: "title", component: "Text", variant: "h4", text: "Progress" },
  {
    id: "bar",
    component: "ProgressBar",
    value: { path: "/donePercent" },
    label: "Share of the list done",
  },
  {
    id: "counts",
    component: "Row",
    justify: "spaceBetween",
    children: ["done", "open"],
  },
  {
    id: "done",
    component: "Text",
    text: {
      call: "formatString",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: A2UI interpolation, not a JS template
      args: { value: "${/done} done · ${/donePercent}%" },
      returnType: "string",
    },
  },
  {
    id: "open",
    component: "Text",
    text: {
      call: "formatString",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: A2UI interpolation, not a JS template
      args: { value: "${/open} open · ${/openPercent}%" },
      returnType: "string",
    },
  },
  {
    id: "total",
    component: "Text",
    text: {
      call: "formatString",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: A2UI interpolation, not a JS template
      args: { value: "${/total} on the list in all" },
      returnType: "string",
    },
  },
];

/**
 * The operations that draw the progress card. The tool returns them under
 * `a2ui_operations`, where the runtime's A2UI middleware picks them out of the
 * tool result and paints the surface — no second model call is involved.
 */
export function progressCardOperations(progress: TodoProgress) {
  return [
    createSurface(PROGRESS_SURFACE_ID, TUTOR_CATALOG_ID),
    updateComponents(PROGRESS_SURFACE_ID, progressCard),
    updateDataModel(PROGRESS_SURFACE_ID, progress),
  ];
}

/**
 * The tutor's write path onto lib/schema.ts's `todos`. Every statement is
 * filtered by the context's `userId`, so a row belonging to another student is
 * invisible rather than merely forbidden — `setTodoDone` on a stolen id reads
 * as "no such item".
 */
export function createTodoTools(db: TodoDb) {
  const listTodos = createTool({
    id: "listTodos",
    description:
      "Read the student's whole to-do list, open and completed items alike. Call this before answering any question about what is on the list.",
    inputSchema: z.object({}),
    outputSchema: z.object({ todos: z.array(Todo) }),
    requestContextSchema,
    // `requestContext` is typed by requestContextSchema and always present.
    execute: async (_input, { requestContext }) => ({
      todos: await listTodosFor(db, requestContext.get("userId")),
    }),
  });

  const addTodo = createTool({
    id: "addTodo",
    description:
      "Put one new item on the student's to-do list. Pass the item as a short imperative phrase; call it once per item.",
    inputSchema: z.object({
      title: z.string().min(1).describe("The item, e.g. 'Buy milk'"),
    }),
    outputSchema: z.object({ todo: Todo }),
    requestContextSchema,
    execute: async ({ title }, { requestContext }) => ({
      todo: await addTodoFor(db, requestContext.get("userId"), title),
    }),
  });

  const setTodoDone = createTool({
    id: "setTodoDone",
    description:
      "Mark one item on the student's list completed, or put it back to open. Take the id from listTodos.",
    inputSchema: z.object({
      id: z.string().min(1).describe("The item's id, as listTodos reported it"),
      done: z.boolean().describe("true to complete it, false to reopen it"),
    }),
    outputSchema: z.object({
      todo: Todo.nullable().describe(
        "null when the student's list holds no item with that id",
      ),
    }),
    requestContextSchema,
    execute: async ({ id, done }, { requestContext }) => ({
      todo: await setTodoDoneFor(db, requestContext.get("userId"), id, done),
    }),
  });

  const showProgress = createTool({
    id: "showProgress",
    description:
      "Show the student a card in the chat with their progress on the list: how many items there are, and what share is done and what share is open. The card displays the figures itself.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      progress: z.object({
        total: z.number(),
        done: z.number(),
        open: z.number(),
        donePercent: z.number(),
        openPercent: z.number(),
      }),
      [A2UI_OPERATIONS_KEY]: z.array(z.record(z.string(), z.unknown())),
    }),
    requestContextSchema,
    execute: async (_input, { requestContext }) => {
      const progress = await todoProgressFor(db, requestContext.get("userId"));
      return {
        progress,
        [A2UI_OPERATIONS_KEY]: progressCardOperations(progress),
      };
    },
  });

  return { listTodos, addTodo, setTodoDone, showProgress };
}
