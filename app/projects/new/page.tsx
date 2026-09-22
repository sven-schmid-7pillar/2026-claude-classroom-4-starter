import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProjectWizard } from "@/components/project-wizard";
import { SignOutButton } from "@/components/sign-out-button";
import { HeaderLink, PageHeader } from "@/components/ui/page-header";
import { auth } from "@/lib/auth";
import { PROJECT_AGENT_ID } from "@/lib/project-agent";

export default async function NewProject() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  // The client has its own clock and its own time zone, so the day the page
  // plans against is decided once, here on the server.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="New project"
        subtitle={session.user.name}
        nav={<HeaderLink href="/">To-do chat</HeaderLink>}
      >
        <SignOutButton />
      </PageHeader>
      <main className="flex flex-1 overflow-hidden bg-ground">
        <ProjectWizard agentId={PROJECT_AGENT_ID} today={today} />
      </main>
    </>
  );
}
