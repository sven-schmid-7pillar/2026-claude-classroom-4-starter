"use client";

import {
  type CatalogComponentDefinition,
  createCatalog,
  DynamicNumberSchema,
  DynamicStringSchema,
} from "@copilotkit/a2ui-renderer";
import type { ReactNode } from "react";
// zod 3's API on purpose: A2UI's binder tells a bindable prop from a literal
// by reading zod 3 internals (`_def.typeName`), which zod 4 schemas lack, so a
// prop declared with the app's own zod would never resolve its `path`.
import { z } from "zod/v3";
import { ProgressBar } from "@/components/ui/progress-bar";
import { TUTOR_CATALOG_ID } from "@/lib/a2ui";

/**
 * A component's props schema, cast once here. The renderer, A2UI's core, and
 * `zod/v3` each resolve their own copy of zod 3, and TypeScript treats a class
 * with a private field as nominal, so their `ZodObject`s never line up even
 * though the binder only inspects them structurally. The cost is that the
 * renderers below receive untyped props and narrow them themselves.
 */
function props(shape: Record<string, unknown>) {
  return z.object(
    shape as z.ZodRawShape,
  ) as unknown as CatalogComponentDefinition["props"];
}

/**
 * What the tutor's A2UI surfaces may draw beyond the basic catalog. A prop on
 * a `Dynamic*Schema` takes a literal or a `{ path }` into the data model, and
 * the renderer resolves it before the component sees it.
 */
const definitions = {
  ProgressBar: {
    description:
      "A horizontal bar showing a share as a percentage from 0 to 100. Pair it with a Text that states the figure.",
    props: props({
      value: DynamicNumberSchema.describe("The share, 0 to 100."),
      label: DynamicStringSchema.describe(
        "What the share is of, for assistive technology.",
      ),
    }),
  },
  FieldError: {
    description:
      "The validation message under an input. Draws nothing while the text is empty.",
    props: props({
      text: DynamicStringSchema.describe("The message, or empty for none."),
    }),
  },
  // Replaces the basic Card by name. That one is inline-styled white with an
  // 8px radius and a drop shadow, which breaks the square, hairline look and
  // leaves light text on white in the dark theme.
  Card: {
    description: "A panel that holds one child component.",
    props: props({ child: z.string().describe("The child's id.") }),
  },
};

/**
 * Registered on the CopilotKit provider (components/chat.tsx). It keeps every
 * basic component and adds the ones above; custom entries come after the
 * basic ones, so a name they share resolves to ours.
 */
export const tutorCatalog = createCatalog(
  definitions,
  {
    // The basic components space their leaves with an 8px inline margin, so
    // the bar takes the same to sit on their rhythm.
    ProgressBar: ({ props }) => (
      <div className="m-2">
        <ProgressBar
          value={typeof props.value === "number" ? props.value : undefined}
          label={String(props.label ?? "")}
        />
      </div>
    ),
    // A missing path resolves to `undefined`, so an absent error draws nothing
    // rather than an empty, margined line. Same 8px inset as the input above.
    FieldError: ({ props }) =>
      typeof props.text === "string" && props.text ? (
        <p className="mx-2 text-sm text-danger">{props.text}</p>
      ) : null,
    // Headings inside get the system's 600 weight, which Tailwind's preflight
    // strips from the basic Text's bare <h1>–<h5>.
    Card: ({ props, children }) => (
      <div className="my-1.5 w-full border border-edge bg-surface p-2 text-ink [&_:is(h1,h2,h3,h4,h5)]:font-semibold">
        {typeof props.child === "string"
          ? (children(props.child) as ReactNode)
          : null}
      </div>
    ),
  },
  { catalogId: TUTOR_CATALOG_ID, includeBasicCatalog: true },
);
