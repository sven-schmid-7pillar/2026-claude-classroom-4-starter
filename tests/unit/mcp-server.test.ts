// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import * as schema from "@/lib/schema";
import { todos, user } from "@/lib/schema";

// lib/mcp-app-views and lib/todo-tools are `server-only`.
vi.mock("server-only", () => ({}));

const { createTodoMcpServer, TODO_FORM_URI } = await import("@/lib/mcp-server");
const { addTodoFor, listTodosFor, setTodoDoneFor } = await import(
  "@/lib/todo-tools"
);

let dir: string;
let db: ReturnType<typeof drizzle<typeof schema>>;
let client: Client;

beforeAll(async () => {
  // A throwaway view instead of the git-ignored build output, and a throwaway
  // database instead of data/app.db.
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-mcp-server-"));
  await writeFile(join(dir, "todo-form.html"), "<!doctype html><p>form</p>");
  db = drizzle({ connection: { url: `file:${join(dir, "test.db")}` }, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  // todos.userId is a FK onto the Better Auth user table.
  await db.insert(user).values([
    { id: "user-ada", name: "Ada", email: "ada@example.com" },
    { id: "user-grace", name: "Grace", email: "grace@example.com" },
  ]);

  // The server of Ada's token, as app/api/mcp/route.ts would build it.
  const server = createTodoMcpServer(db, "user-ada", dir);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(todos);
});

test("open_todo_form links to the todo-form ui resource", async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === "open_todo_form");

  expect(tool?._meta).toMatchObject({ ui: { resourceUri: TODO_FORM_URI } });
  expect(TODO_FORM_URI).toMatch(/^ui:\/\//);
  expect(tool?.inputSchema.properties).toHaveProperty("title");
  expect(tool?.inputSchema.required ?? []).not.toContain("title");
});

test("the ui resource serves the built view as an MCP App", async () => {
  const { contents } = await client.readResource({ uri: TODO_FORM_URI });

  expect(contents).toEqual([
    {
      uri: TODO_FORM_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: "<!doctype html><p>form</p>",
    },
  ]);
  expect(RESOURCE_MIME_TYPE).toBe("text/html;profile=mcp-app");
});

test("open_todo_form returns the drafted title and the open to-dos", async () => {
  const milk = await addTodoFor(db, "user-ada", "Buy milk");
  const post = await addTodoFor(db, "user-ada", "Post letter");
  await setTodoDoneFor(db, "user-ada", post.id, true);
  await addTodoFor(db, "user-grace", "Grace's own");

  const result = await client.callTool({
    name: "open_todo_form",
    arguments: { title: "Water plants" },
  });

  expect(result.structuredContent).toEqual({
    title: "Water plants",
    openTodos: [milk],
  });
});

test("tools/list marks submit_todo_form as callable by the app only", async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === "submit_todo_form");

  expect(tool?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  expect(tool?.inputSchema.required).toContain("title");
});

test("submit_todo_form saves for the calling user only", async () => {
  const milk = await addTodoFor(db, "user-ada", "Buy milk");
  await addTodoFor(db, "user-grace", "Grace's own");

  const result = await client.callTool({
    name: "submit_todo_form",
    arguments: { title: "  Water plants  " },
  });

  expect(result.isError).toBeFalsy();
  const { todo, openTodos } = result.structuredContent as {
    todo: { id: string; title: string; done: boolean };
    openTodos: unknown[];
  };
  expect(todo).toMatchObject({ title: "Water plants", done: false });
  expect(openTodos).toEqual([milk, todo]);
  expect(await listTodosFor(db, "user-ada")).toEqual([milk, todo]);
  expect(
    (await listTodosFor(db, "user-grace")).map((row) => row.title),
  ).toEqual(["Grace's own"]);
});

test("submit_todo_form rejects an empty title and saves nothing", async () => {
  const result = await client.callTool({
    name: "submit_todo_form",
    arguments: { title: "   " },
  });

  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(await listTodosFor(db, "user-ada")).toEqual([]);
});
