"use client";

import type { Message } from "@ag-ui/client";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { CopilotKit, useAgent } from "@copilotkit/react-core/v2";
import { type FormEvent, useState } from "react";
import { tutorCatalog } from "@/components/a2ui-catalog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PROJECT_CARD_CONTEXT, PROJECT_SURFACE_ID } from "@/lib/project-card";
import { parseToolResult } from "@/lib/tool-result";

type Operations = Array<Record<string, unknown>>;

/** The card's operations, from the activity the runtime's A2UI middleware adds. */
function surfaceOperations(messages: Message[]): Operations | null {
  for (const message of messages) {
    if (message.role !== "activity" || message.activityType !== "a2ui-surface")
      continue;
    const operations = message.content.a2ui_operations;
    if (Array.isArray(operations)) return operations as Operations;
  }
  return null;
}

/** The status line for a run: the tool's own `describeChanges` summary. */
function describeRun(messages: Message[]): string | null {
  for (const message of messages) {
    if (message.role !== "tool") continue;
    const result = parseToolResult(message.content) as {
      summary?: unknown;
    } | null;
    if (typeof result?.summary === "string") return result.summary;
  }
  return null;
}

/**
 * The wizard itself, inside both providers. Each submit is one single-turn run
 * on a fresh thread: the agent has no memory, and the runtime would otherwise
 * replay the earlier runs of a reused thread into it. What the turns build up
 * lives in the card's data model instead, which every run carries along.
 */
function Wizard({ agentId, today }: { agentId: string; today: string }) {
  const { agent, isReady } = useAgent({ agentId });
  const surfaces = useA2UIActions();
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = instruction.trim();
    if (!text || running) return;

    setRunning(true);
    setStatus("Working it out…");
    agent.threadId = crypto.randomUUID();
    agent.setMessages([
      { id: crypto.randomUUID(), role: "user", content: text },
    ]);
    // The card as it stands, the user's own edits included. Without one the
    // tool creates the surface; with one it only updates its data model.
    const card = surfaces.getSurface(PROJECT_SURFACE_ID);
    const context = card
      ? [
          {
            description: PROJECT_CARD_CONTEXT,
            value: JSON.stringify(card.dataModel.get("/")),
          },
        ]
      : [];
    try {
      const { newMessages } = await agent.runAgent({ context });
      const operations = surfaceOperations(newMessages);
      if (operations) {
        // Applied on top of the surface already there, so the card changes in
        // place; only the first run's operations create it.
        surfaces.processMessages(operations);
        setInstruction("");
      }
      setStatus(
        (operations && describeRun(newMessages)) ??
          "The card was not filled in. Try saying it another way.",
      );
    } catch {
      setStatus("The wizard could not be reached. Try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <section className="flex-1 overflow-y-auto border border-edge bg-surface">
        <div className="border-b border-edge px-3 py-2">
          <h1 className="text-xl font-semibold text-ink">Project card</h1>
          <p className="text-sm text-ink-mute">Planning as of {today}.</p>
        </div>
        <div className="a2ui-form p-2">
          <A2UIRenderer
            surfaceId={PROJECT_SURFACE_ID}
            fallback={
              <p className="px-1 py-2 text-sm text-ink-mute">
                The card fills in after your first instruction.
              </p>
            }
          />
        </div>
      </section>

      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            id="instruction"
            label="Instruction"
            className="w-full"
            autoComplete="off"
            placeholder="Plan a six month website relaunch"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={!isReady || running}>
          Send
        </Button>
      </form>
      <p aria-live="polite" className="min-h-5 text-sm text-ink-soft">
        {status}
      </p>
    </div>
  );
}

/**
 * The project wizard: an instruction box that runs the wizard agent, and the
 * project card it paints, drawn as an A2UI surface on the page rather than in
 * a chat. There is no CopilotChat and no transcript; the page reads the run's
 * messages itself and hands the card's operations to its own A2UIProvider.
 */
export function ProjectWizard({
  agentId,
  today,
}: {
  agentId: string;
  today: string;
}) {
  return (
    // No `a2ui` prop: that would send the catalog's schema into the agent's
    // context, and the card's tree is fixed.
    <CopilotKit runtimeUrl="/api/project-agent" credentials="include">
      <A2UIProvider catalog={tutorCatalog}>
        <Wizard agentId={agentId} today={today} />
      </A2UIProvider>
    </CopilotKit>
  );
}
