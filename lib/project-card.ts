import {
  createSurface,
  updateComponents,
  updateDataModel,
} from "@ag-ui/a2ui-toolkit";
import { TUTOR_CATALOG_ID } from "@/lib/a2ui";
import {
  criticalities,
  emptyProject,
  type Project,
  type ProjectErrors,
  projectSchema,
} from "@/lib/project";

/**
 * The project card the wizard page draws with A2UI. A plain module like
 * lib/project.ts: the wizard agent's tool builds the operations, and the page
 * names the same surface and context entry.
 */
export const PROJECT_SURFACE_ID = "project-card";

/**
 * The `description` of the AG-UI context entry that carries the card's current
 * data model from the page to the agent. The agent has no memory, so this is
 * the only way the previous turns, and the user's own edits, reach a run.
 */
export const PROJECT_CARD_CONTEXT = "The project card's current data model";

/** An input and, under it, the slot its validation error shows in. */
function field(id: string, input: Record<string, unknown>, error?: string) {
  return [
    {
      id: `${id}-field`,
      component: "Column",
      children: error ? [id, `${id}-error`] : [id],
    },
    { id, ...input },
    ...(error
      ? [{ id: `${id}-error`, component: "FieldError", text: { path: error } }]
      : []),
  ];
}

/**
 * The card's component tree in A2UI v0.9's flat form, authored once here, as
 * the progress card's is (lib/todo-tools.ts). Every field is an input from the
 * basic catalog whose `value` is a `path` into the data model, so the tree is
 * fixed, a run changes only the data model, and an edit in the browser writes
 * straight back into it. Only the fields lib/project.ts can reject get an
 * error slot.
 */
const projectCard = [
  // No Card around it: the page's own panel frames and titles the surface.
  {
    id: "root",
    component: "Column",
    children: [
      "title-field",
      "description-field",
      "dates",
      "effort-field",
      "level-field",
    ],
  },
  ...field("title", {
    component: "TextField",
    label: "Title",
    value: { path: "/title" },
  }),
  ...field("description", {
    component: "TextField",
    label: "Description",
    variant: "longText",
    value: { path: "/description" },
  }),
  { id: "dates", component: "Row", children: ["start-field", "end-field"] },
  ...field(
    "start",
    {
      component: "DateTimeInput",
      label: "Start date",
      enableDate: true,
      value: { path: "/startDate" },
    },
    "/errors/startDate",
  ),
  ...field(
    "end",
    {
      component: "DateTimeInput",
      label: "End date",
      enableDate: true,
      value: { path: "/endDate" },
    },
    "/errors/endDate",
  ),
  ...field(
    "effort",
    {
      component: "TextField",
      label: "Effort in person-days",
      variant: "number",
      value: { path: "/effortPersonDays" },
    },
    "/errors/effortPersonDays",
  ),
  ...field("level", {
    component: "ChoicePicker",
    label: "Criticality",
    variant: "mutuallyExclusive",
    options: criticalities.map((value) => ({ label: value, value })),
    value: { path: "/criticality" },
  }),
];

/**
 * The project as the card's data model holds it: the project itself, except
 * that `ChoicePicker` binds to a list of selected values, so the criticality
 * travels as a one-item list, plus one message per error slot under `errors`,
 * empty unless the last run rejected that field. Every slot is present so
 * every binding in the tree resolves.
 */
export function projectCardData(project: Project, errors: ProjectErrors = {}) {
  return {
    ...project,
    criticality: [project.criticality],
    errors: {
      startDate: errors.startDate ?? "",
      endDate: errors.endDate ?? "",
      effortPersonDays: errors.effortPersonDays ?? "",
    },
  };
}

/**
 * Reads a project back out of a card data model the browser sent. Each field is
 * taken only if it has the right shape, and falls back to the empty project's
 * value otherwise. The effort input writes a string once edited by hand.
 */
export function projectFromCardData(data: unknown): Project {
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const project: Project = { ...emptyProject };
  const shape = projectSchema.shape;

  for (const key of ["title", "description", "startDate", "endDate"] as const) {
    const parsed = shape[key].safeParse(record[key]);
    if (parsed.success) project[key] = parsed.data;
  }
  const effort = Number(record.effortPersonDays);
  if (Number.isFinite(effort) && effort >= 0) project.effortPersonDays = effort;
  const level = shape.criticality.safeParse(
    Array.isArray(record.criticality) ? record.criticality[0] : undefined,
  );
  if (level.success) project.criticality = level.data;

  return project;
}

/**
 * The operations for one run. The first creates the surface and its tree; a
 * later one, `existing`, only replaces the data model of the same surface, so
 * the card changes in place. No second model call either way: the runtime's
 * A2UI middleware picks them out of the tool result under `a2ui_operations`.
 */
export function projectCardOperations(
  project: Project,
  errors: ProjectErrors,
  existing: boolean,
) {
  const data = updateDataModel(
    PROJECT_SURFACE_ID,
    projectCardData(project, errors),
  );
  if (existing) return [data];
  return [
    createSurface(PROJECT_SURFACE_ID, TUTOR_CATALOG_ID),
    updateComponents(PROJECT_SURFACE_ID, projectCard),
    data,
  ];
}
