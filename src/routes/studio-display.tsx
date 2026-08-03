import { createFileRoute, redirect } from "@tanstack/react-router";
import { getGateStatus } from "@/lib/gate.functions";
import { AppShell, PageHeader } from "@/components/AppShell";
import { StudioDisplayPanel } from "@/components/StudioDisplayPanel";

export const Route = createFileRoute("/studio-display")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  head: () => ({
    meta: [
      { title: "Studio Display Settings — Studio Operator" },
      {
        name: "description",
        content: "Configure the custom studio display timer and teacher notes, then open the display window.",
      },
      { property: "og:title", content: "Studio Display Settings — Studio Operator" },
      {
        property: "og:description",
        content: "Configure the custom studio display timer and teacher notes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudioDisplaySettingsPage,
});

function StudioDisplaySettingsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Studio Display"
        subtitle="Custom timer and notes for the teacher-facing screen. Class displays open from the dashboard."
      />
      <div className="max-w-xl">
        <StudioDisplayPanel />
      </div>
    </AppShell>
  );
}
