import { MastraAgent } from "@ag-ui/mastra";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { auth } from "@/lib/auth";
import { PROJECT_AGENT_ID, projectRequestContext } from "@/lib/project-agent";
import { mastra } from "@/lib/tutor";

const basePath = "/api/project-agent";

/**
 * The project wizard's runtime, apart from the chat's
 * (app/api/copilotkit/[...all]/route.ts) because the runtime's A2UI options
 * apply to every agent it serves, and this one must not get the chat's
 * injected render tool.
 */
async function handler(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // The agent has no memory, so `resourceId` only satisfies the bridge. Today's
  // date is decided here, on the server, for the instructions to read.
  const agent = new MastraAgent({
    agentId: PROJECT_AGENT_ID,
    agent: mastra.getAgent(PROJECT_AGENT_ID),
    resourceId: session.user.id,
    requestContext: projectRequestContext(
      new Date().toISOString().slice(0, 10),
    ),
    // The bridge's own `generate_a2ui` stays off whatever the run forwards:
    // the card's tree is fixed, so there is nothing for a subagent to compose.
    a2ui: { injectA2UITool: false },
  });

  // The middleware still paints the `a2ui_operations` in fillProjectCard's
  // result; `injectA2UITool: false` keeps `render_a2ui` out of the tool list.
  const runtime = new CopilotRuntime({
    agents: { [PROJECT_AGENT_ID]: agent },
    a2ui: { injectA2UITool: false },
  });

  return createCopilotRuntimeHandler({ runtime, basePath })(request);
}

export const GET = handler;
export const POST = handler;
