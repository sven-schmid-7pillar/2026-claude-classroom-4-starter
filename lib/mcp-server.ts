import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { mcpAppTools, mcpToolResult, mcpTools } from "ai-tutor-api-contract";
import { readView } from "@/lib/mcp-app-views";
import {
  addTodoFor,
  listTodosFor,
  setTodoDoneFor,
  type TodoDb,
} from "@/lib/todo-tools";

/** The `ui://` resource the host loads into an iframe for open_todo_form. */
export const TODO_FORM_URI = "ui://ai-tutor/todo-form.html";

/**
 * The `ai-tutor mcp --stdio` tools served from inside the app: same names,
 * descriptions, and schemas (from the contract), but straight onto the todos
 * table instead of through /api/todos. `userId` is fixed when the server is
 * built, and app/api/mcp/route.ts builds one per request from the verified
 * access token, so no tool argument can name another user's list.
 *
 * On top of those, the MCP App tools, which only this server has.
 */
export function createTodoMcpServer(
  db: TodoDb,
  userId: string,
  viewsDir?: string,
) {
  const server = new McpServer({ name: "ai-tutor", version: "0.1.0" });

  server.registerTool("list_todos", mcpTools.list_todos, async ({ q }) =>
    mcpToolResult({ todos: await listTodosFor(db, userId, q) }),
  );

  server.registerTool("add_todo", mcpTools.add_todo, async ({ title }) =>
    mcpToolResult({ todo: await addTodoFor(db, userId, title) }),
  );

  server.registerTool(
    "mark_todo_done",
    mcpTools.mark_todo_done,
    async ({ id }) => {
      const todo = await setTodoDoneFor(db, userId, id, true);
      // Thrown errors become `isError` results; another user's id reads as
      // unknown, same as PATCH /api/todos/:id answering 404.
      if (!todo) throw new Error(`not_found: no to-do with id ${id}`);
      return mcpToolResult({ todo });
    },
  );

  const openTodos = async () =>
    (await listTodosFor(db, userId)).filter((todo) => !todo.done);

  // The view reads the title from the tool *input* the host forwards; the
  // result brings the open list the form shows, and the title as the fallback
  // for hosts that cannot render a view.
  registerAppTool(
    server,
    "open_todo_form",
    {
      ...mcpAppTools.open_todo_form,
      _meta: { ui: { resourceUri: TODO_FORM_URI } },
    },
    async ({ title }) =>
      mcpToolResult({ title: title ?? "", openTodos: await openTodos() }),
  );

  // The form's Add button. `visibility: ["app"]` tells the host to keep it
  // out of the model's tool list and accept it only from this server's view,
  // so a to-do enters the list here only when the user presses Add. The input
  // schema (CreateTodoRequest) turns a blank title into an `isError` result
  // before the handler runs.
  registerAppTool(
    server,
    "submit_todo_form",
    {
      ...mcpAppTools.submit_todo_form,
      // No resourceUri: the form calls this, it does not open another form.
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ title }) =>
      mcpToolResult({
        todo: await addTodoFor(db, userId, title),
        openTodos: await openTodos(),
      }),
  );

  registerAppResource(
    server,
    "To-do form",
    TODO_FORM_URI,
    { description: "Form for adding one item to the to-do list." },
    async () => ({
      contents: [
        {
          uri: TODO_FORM_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readView("todo-form", viewsDir),
        },
      ],
    }),
  );

  return server;
}
