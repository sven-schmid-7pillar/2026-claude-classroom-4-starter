// jsdom, the config default.
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, test } from "vitest";
import { tutorCatalog } from "@/components/a2ui-catalog";
import { ProgressBar } from "@/components/ui/progress-bar";
import { TUTOR_CATALOG_ID } from "@/lib/a2ui";

describe("ProgressBar", () => {
  test("exposes the share as an accessible progressbar", () => {
    render(<ProgressBar value={60} label="Share of the list done" />);

    const bar = screen.getByRole("progressbar", {
      name: "Share of the list done",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "60");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar.firstElementChild).toHaveStyle({ width: "60%" });
  });

  test.each([
    [140, "100"],
    [-5, "0"],
    [Number.NaN, "0"],
    [undefined, "0"],
  ])("clamps %s to the track", (value, now) => {
    render(<ProgressBar value={value} label="Share" />);

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      now,
    );
  });

  test("stays square and off the signal blue", () => {
    render(<ProgressBar value={50} label="Share" />);

    const bar = screen.getByRole("progressbar");
    const classes = `${bar.className} ${bar.firstElementChild?.className}`;
    expect(classes).not.toMatch(/rounded|shadow|accent|brand/);
  });
});

/** Feeds operations into the provider, as the chat's surface host does. */
function Feed({ operations }: { operations: Record<string, unknown>[] }) {
  const { processMessages } = useA2UIActions();
  useEffect(() => processMessages(operations), [processMessages, operations]);
  return null;
}

describe("ProgressBar in the tutor's catalog", () => {
  test("reads its value from the surface's data model", async () => {
    const operations = [
      {
        version: "v0.9",
        createSurface: { surfaceId: "s", catalogId: TUTOR_CATALOG_ID },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Card", child: "bar" },
            {
              id: "bar",
              component: "ProgressBar",
              value: { path: "/share" },
              label: "Share",
            },
          ],
        },
      },
      {
        version: "v0.9",
        updateDataModel: { surfaceId: "s", path: "/", value: { share: 25 } },
      },
    ];

    render(
      <A2UIProvider catalog={tutorCatalog}>
        <Feed operations={operations} />
        <A2UIRenderer surfaceId="s" />
      </A2UIProvider>,
    );

    expect(
      await screen.findByRole("progressbar", { name: "Share" }),
    ).toHaveAttribute("aria-valuenow", "25");
  });
});
