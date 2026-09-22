// No framework: the built file is the whole view, and every byte of it — the
// ext-apps client included — ships inside the one HTML document the host loads.
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps";

const titleInput = document.getElementById("todo-title") as HTMLInputElement;
const addButton = document.getElementById("add-todo") as HTMLButtonElement;
const titleError = document.getElementById(
  "todo-title-error",
) as HTMLParagraphElement;
const statusLine = document.getElementById("status") as HTMLParagraphElement;
const openList = document.getElementById("open-todos") as HTMLUListElement;
const openEmpty = document.getElementById(
  "open-todos-empty",
) as HTMLParagraphElement;

/** Prefills the input with the title the tool was called with. */
export function setTitle(text: string) {
  titleInput.value = text;
  syncAddButton();
}

export function setStatus(text: string, kind: "info" | "error" = "info") {
  statusLine.textContent = text;
  statusLine.dataset.kind = kind;
}

/** A rejected title's message sits under the field; an empty text clears it. */
export function setTitleError(text: string) {
  titleError.textContent = text;
  titleError.hidden = text === "";
  if (text === "") titleInput.removeAttribute("aria-invalid");
  else titleInput.setAttribute("aria-invalid", "true");
}

type TodoRow = { id: string; title: string };

export function renderOpenTodos(items: TodoRow[]) {
  openList.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("li");
      row.dataset.id = String(item.id);
      // textContent, never innerHTML: a to-do title is someone's own text.
      row.textContent = item.title;
      return row;
    }),
  );
  openEmpty.hidden = items.length > 0;
}

/** True while submit_todo_form is in flight, so a second click cannot add twice. */
let saving = false;

/** An empty title is not a to-do, so the button says so before the click does. */
function syncAddButton() {
  addButton.disabled = saving || titleInput.value.trim() === "";
}

/**
 * The open list out of either tool's structuredContent. Checked by hand
 * rather than with the contract's zod schemas, which would ship zod inside
 * the view for one array.
 */
function readOpenTodos(value: unknown): TodoRow[] | undefined {
  const rows = (value as { openTodos?: unknown } | undefined)?.openTodos;
  if (!Array.isArray(rows)) return undefined;
  return rows.filter(
    (row): row is TodoRow =>
      typeof row?.id === "string" && typeof row?.title === "string",
  );
}

/**
 * Tells the model what the user saved, so its next turn knows without calling
 * list_todos. The host sends only the latest update, with the next message.
 */
async function reportToModel(todo: TodoRow, open: TodoRow[]) {
  const lines = open.map((row) => `- ${row.title} (id ${row.id})`);
  const text = [
    `The user added "${todo.title}" (id ${todo.id}) to their to-do list with the form.`,
    open.length > 0
      ? `Their open to-dos are now:\n${lines.join("\n")}`
      : "They have no open to-dos.",
  ].join("\n\n");
  try {
    await app.updateModelContext({ content: [{ type: "text", text }] });
  } catch {
    // A host without model context still has the saved item and the list.
  }
}

async function onSubmit(title: string) {
  saving = true;
  syncAddButton();
  setTitleError("");
  setStatus("Adding…");
  try {
    const result = await app.callServerTool({
      name: "submit_todo_form",
      arguments: { title },
    });
    const todo = (result.structuredContent as { todo?: TodoRow } | undefined)
      ?.todo;
    if (result.isError || !todo) {
      // The only input the server can reject is the title.
      setTitleError(
        "The list did not take that title. Type what to do, then press Add.",
      );
      setStatus("Nothing was added.", "error");
      return;
    }
    const open = readOpenTodos(result.structuredContent) ?? [];
    renderOpenTodos(open);
    setTitle("");
    setStatus(`Added “${todo.title}”.`);
    await reportToModel(todo, open);
  } catch {
    setStatus(
      "The list could not be reached, so nothing was added. Press Add to try again.",
      "error",
    );
  } finally {
    saving = false;
    syncAddButton();
  }
}

/**
 * Theme, style variables and fonts from the host. The context the handshake
 * returns is whole, while a change notification carries only the fields that
 * changed, so each field is applied only when present.
 */
function applyHostContext(context: Partial<McpUiHostContext>) {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }
  // ext-apps injects the font CSS once and ignores later calls.
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

const app = new App({ name: "ai-tutor to-do form", version: "0.1.0" });

// Every handler before connect(): the host may send the tool input, its result
// and a context change right after the handshake, and a late handler misses them.
app.ontoolinput = ({ arguments: args }) => {
  const title = args?.title;
  if (typeof title === "string") setTitle(title);
};
// open_todo_form's result carries the open list, so the form shows it at once.
app.ontoolresult = ({ structuredContent }) => {
  const open = readOpenTodos(structuredContent);
  if (open) renderOpenTodos(open);
};
app.onhostcontextchanged = applyHostContext;

app
  .connect(new PostMessageTransport(window.parent, window.parent))
  .then(() => {
    const context = app.getHostContext();
    if (context) applyHostContext(context);
  })
  .catch(() => {
    // Opened outside a host, such as the built file straight in a browser:
    // the form still renders, it just has no one to talk to.
    setStatus("Not connected to an MCP host.", "error");
  });

function submit() {
  const title = titleInput.value.trim();
  if (title === "" || saving) return;
  onSubmit(title);
}

titleInput.addEventListener("input", () => {
  setTitleError("");
  syncAddButton();
});
titleInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  // The view is one field, so Enter is the submit an outer <form> would give.
  event.preventDefault();
  submit();
});
addButton.addEventListener("click", submit);

syncAddButton();
renderOpenTodos([]);
