// @vitest-environment node
import { A2uiMessageListSchema, MessageProcessor } from "@a2ui/web_core/v0_9";
import { tryParseA2UIOperations } from "@ag-ui/a2ui-middleware";
import { validateA2UIComponents } from "@ag-ui/a2ui-toolkit";
import { RequestContext } from "@mastra/core/request-context";
import { expect, test } from "vitest";

import { tutorCatalog } from "@/components/a2ui-catalog";
import { TUTOR_CATALOG_ID } from "@/lib/a2ui";
import type { Project, ProjectPatch } from "@/lib/project";
import { fillProjectCard } from "@/lib/project-agent";
import { PROJECT_CARD_CONTEXT, PROJECT_SURFACE_ID } from "@/lib/project-card";

type Operation = Record<string, unknown>;
type FillResult = {
  project: Project;
  errors: Record<string, string>;
  summary: string;
  a2ui_operations: Operation[];
};

/**
 * A run's RequestContext as `@ag-ui/mastra` builds it: the browser's AG-UI
 * context under "ag-ui". With a data model, it carries the card as the page
 * sends it; without one, the page has no card yet.
 */
function runContext(dataModel?: unknown) {
  const requestContext = new RequestContext();
  requestContext.set("ag-ui", {
    context: dataModel
      ? [
          {
            description: PROJECT_CARD_CONTEXT,
            value: JSON.stringify(dataModel),
          },
        ]
      : [],
  });
  return requestContext;
}

// Same cast as todo-progress.test.ts: runs the real executor, typed plainly.
const fill = (patch: ProjectPatch, requestContext: RequestContext) =>
  (
    fillProjectCard.execute as (
      input: ProjectPatch,
      context: never,
    ) => Promise<FillResult>
  )(patch, { requestContext } as never);

/** The data model an operation list leaves the card with. */
function dataModelOf(operations: Operation[]) {
  const last = operations.at(-1) as {
    updateDataModel: { surfaceId: string; value: Record<string, unknown> };
  };
  return last.updateDataModel;
}

test("the first call creates the surface, a later one only updates its data model", async () => {
  const first = await fill(
    {
      title: "Website relaunch",
      startDate: "2026-09-28",
      endDate: "2026-10-16",
      effortPersonDays: 30,
    },
    runContext(),
  );

  // Well-formed v0.9 messages that create the surface on the tutor catalog,
  // found by the middleware's own parse of the result as the bridge ships it.
  expect(A2uiMessageListSchema.safeParse(first.a2ui_operations).success).toBe(
    true,
  );
  expect(tryParseA2UIOperations(JSON.stringify(first))).toEqual({
    operations: first.a2ui_operations,
  });
  const [create, components] = first.a2ui_operations as [
    { createSurface: { surfaceId: string; catalogId: string } },
    { updateComponents: { components: Operation[] } },
  ];
  expect(create.createSurface).toEqual({
    surfaceId: PROJECT_SURFACE_ID,
    catalogId: TUTOR_CATALOG_ID,
  });
  expect(
    validateA2UIComponents({
      components: components.updateComponents.components,
      data: dataModelOf(first.a2ui_operations).value,
      catalog: {
        components: Object.fromEntries(
          [...tutorCatalog.components.keys()].map((name) => [name, {}]),
        ),
      },
    }).errors,
  ).toEqual([]);
  const processor = new MessageProcessor([tutorCatalog]);
  processor.processMessages(first.a2ui_operations as never);

  // The user edits the card by hand before the next instruction: effort as
  // the number input writes it, criticality through the choice picker.
  const edited = {
    ...dataModelOf(first.a2ui_operations).value,
    effortPersonDays: "40",
    criticality: ["high"],
  };
  const second = await fill({ endDate: "2026-10-23" }, runContext(edited));

  // One data model update to the same surface, applied in place.
  expect(second.a2ui_operations.map((op) => Object.keys(op).sort())).toEqual([
    ["updateDataModel", "version"],
  ]);
  expect(dataModelOf(second.a2ui_operations).surfaceId).toBe(
    PROJECT_SURFACE_ID,
  );
  expect(() =>
    processor.processMessages(second.a2ui_operations as never),
  ).not.toThrow();

  // Built on the first turn and the edits, not on an empty project.
  expect(second.project).toEqual({
    title: "Website relaunch",
    description: "",
    startDate: "2026-09-28",
    endDate: "2026-10-23",
    effortPersonDays: 40,
    criticality: "high",
  });
  expect(second.summary).toBe("Set end date to 2026-10-23.");
});

test("a rejected field keeps its value and comes back as an error in the card", async () => {
  const card = {
    title: "Website relaunch",
    description: "",
    startDate: "2026-09-28",
    endDate: "2026-10-16",
    effortPersonDays: 30,
    criticality: ["medium"],
    errors: {},
  };

  const result = await fill(
    { endDate: "2026-09-01", effortPersonDays: 45 },
    runContext(card),
  );

  expect(result.errors).toEqual({
    endDate: "The end date is before the start date.",
  });
  expect(result.project.endDate).toBe("2026-10-16");
  expect(result.summary).toBe("Set effort to 45 person-days.");
  // The message travels in the data model, where the end date's FieldError
  // is bound to it.
  expect(dataModelOf(result.a2ui_operations).value).toMatchObject({
    endDate: "2026-10-16",
    effortPersonDays: 45,
    errors: { endDate: "The end date is before the start date." },
  });
});
