import { A2UI_OPERATIONS_KEY } from "@ag-ui/a2ui-toolkit";
import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { openRouterModel } from "@/lib/openrouter";
import {
  applyProjectPatch,
  describeChanges,
  emptyProject,
  type Project,
  projectPatchSchema,
  projectSchema,
} from "@/lib/project";
import {
  PROJECT_CARD_CONTEXT,
  projectCardOperations,
  projectFromCardData,
} from "@/lib/project-card";

/** Registry key of the wizard agent, and the CopilotKit `agentId` on /projects/new. */
export const PROJECT_AGENT_ID = "project";

/**
 * The day the wizard plans against, as the route decides it. It reaches the
 * agent through the RequestContext rather than the prompt, so the browser's
 * clock never gets a say (same reasoning as app/projects/new/page.tsx).
 */
export function projectRequestContext(today: string) {
  const requestContext = new RequestContext();
  requestContext.set("today", today);
  return requestContext;
}

/**
 * The card the page sent with this run, or `null` when it has none yet. The
 * page sends it as an AG-UI context entry, and `@ag-ui/mastra` puts a run's
 * context on the RequestContext under "ag-ui". It comes from the browser, so
 * every field is checked on the way in (projectFromCardData).
 */
export function currentProject(
  requestContext: { get(key: string): unknown } | undefined,
): Project | null {
  const agUi = requestContext?.get("ag-ui") as
    | { context?: { description: string; value: string }[] }
    | undefined;
  const entry = agUi?.context?.find(
    (item) => item.description === PROJECT_CARD_CONTEXT,
  );
  if (!entry) return null;
  try {
    return projectFromCardData(JSON.parse(entry.value));
  } catch {
    return null;
  }
}

/**
 * The wizard's only tool. The patch lands on the card the page sent, manual
 * edits included, through the rules of lib/project.ts; a field that breaks one
 * keeps its value and its message goes into the card beside it. The result
 * carries the card's A2UI operations, which the runtime's middleware paints
 * without a second model call, as `showProgress` does (lib/todo-tools.ts):
 * the whole surface on the first run, only its data model after that.
 */
export const fillProjectCard = createTool({
  id: "fillProjectCard",
  description:
    "Change the project card as the user's instruction asks. Pass every field the instruction sets or changes, already worked out; leave out a field that stays as it is.",
  inputSchema: projectPatchSchema,
  outputSchema: z.object({
    project: projectSchema,
    errors: z.record(z.string(), z.string()),
    summary: z.string(),
    [A2UI_OPERATIONS_KEY]: z.array(z.record(z.string(), z.unknown())),
  }),
  execute: async (patch, context) => {
    const current = currentProject(context?.requestContext);
    const before = current ?? emptyProject;
    const { project, errors } = applyProjectPatch(before, patch);
    return {
      project,
      errors,
      summary: describeChanges(before, project),
      [A2UI_OPERATIONS_KEY]: projectCardOperations(
        project,
        errors,
        current !== null,
      ),
    };
  },
});

function weekday(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  });
}

/**
 * The prompt. The worked example deliberately uses a different "today" from
 * the real one, so the model has to redo the arithmetic instead of copying
 * the example's dates.
 */
export function projectInstructions(today: string, current: Project | null) {
  const card = current
    ? `The card currently holds:
${JSON.stringify(current, null, 2)}
The instruction builds on it: pass only the fields it changes, worked out from these
values where it is relative ("a week longer", "add a third person").`
    : "The card is still empty.";

  return `You fill in a project card from one instruction. Today is ${weekday(today)}, ${today}.

Your whole answer is one call to fillProjectCard. Do not write any text, before or after
it, and do not ask questions: whatever the instruction leaves open stays as it is.

${card}

Work these fields out and put them in the call:
- title: a short name for the project.
- description: one or two sentences on what it delivers.
- startDate: the first working day, as YYYY-MM-DD. Resolve "next Monday", "in two weeks"
  and the like against today's date.
- endDate: the last working day, as YYYY-MM-DD. A duration counts in working weeks of
  Monday to Friday, so a project of whole weeks that starts on a Monday ends on a Friday.
- effortPersonDays: people times working days, five working days a week; someone
  half-time counts as half a person.
- criticality: low, medium or high, only when the instruction says how critical it is.

Leave out any field the instruction gives you nothing to work from or does not change.

Example, for a today of Tuesday, 2026-03-10:
Instruction: "Website relaunch, starts next Monday, three weeks, two people full-time."
Call: fillProjectCard({"title": "Website relaunch", "description": "Relaunch of the
website.", "startDate": "2026-03-16", "endDate": "2026-04-03", "effortPersonDays": 30})
Next Monday is 2026-03-16; three working weeks later the last Friday is 2026-04-03; two
people for fifteen working days is 30 person-days.`;
}

/**
 * The wizard agent. No memory: each submit is one single-turn run on a fresh
 * thread, and what earlier turns built arrives as the card the page sends,
 * which both the instructions and the tool read. It runs on its own model,
 * because the tutor's reasoning model works the dates out in its reasoning and
 * then leaves them out of the tool call.
 * `toolChoice` forces the call and `maxSteps: 1` ends the run with it, so the
 * model is never asked to comment on the result.
 */
export function createProjectAgent() {
  return new Agent({
    id: PROJECT_AGENT_ID,
    name: "Project wizard",
    instructions: ({ requestContext }) =>
      projectInstructions(
        String(requestContext.get("today")),
        currentProject(requestContext),
      ),
    model: openRouterModel("openrouter/google/gemini-3.1-flash-lite"),
    tools: { fillProjectCard },
    defaultOptions: { maxSteps: 1, toolChoice: "required" },
  });
}
