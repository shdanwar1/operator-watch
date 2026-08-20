import { createFileRoute } from "@tanstack/react-router";
import { BusIcon, SBahnIcon, TramIcon, UBahnIcon } from "@/components/TransitIcons";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/transit-icons")({
  head: () => ({
    meta: [
      { title: "Transit Icon Preview | Operator Watch" },
      {
        name: "description",
        content:
          "Preview of the monochrome U-Bahn, S-Bahn, tram and bus icons used by the Time to Leave card.",
      },
      { property: "og:title", content: "Transit Icon Preview | Operator Watch" },
      {
        property: "og:description",
        content: "Monochrome transit mode icons for light and dark mode.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IconPreview,
});

const ICONS = [
  { label: "U-Bahn", Icon: UBahnIcon },
  { label: "S-Bahn", Icon: SBahnIcon },
  { label: "Tram", Icon: TramIcon },
  { label: "Bus", Icon: BusIcon },
] as const;

function Row({ variant }: { variant: "filled" | "outline" }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {ICONS.map(({ label, Icon }) => (
        <div
          key={label}
          className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <Icon size={44} variant={variant} />
          <div className="flex items-center gap-2">
            <Icon size={16} variant={variant} />
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function IconPreview() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Transit icons</h1>
        <ThemeToggle />
      </header>
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Filled</h2>
        <Row variant="filled" />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Outline</h2>
        <Row variant="outline" />
      </section>
    </main>
  );
}
