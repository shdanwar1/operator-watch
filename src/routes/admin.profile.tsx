import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PinDialog } from "./admin.operators";
import {
  adminChangeOwnPin,
  adminListOperators,
  adminResetOperatorPin,
  type OperatorBasic,
} from "@/lib/operators.functions";
import { getGateStatus } from "@/lib/gate.functions";

export const Route = createFileRoute("/admin/profile")({
  head: () => ({
    meta: [
      { title: "Admin Profile — Dance Masterclass Admin" },
      {
        name: "description",
        content: "Manage the administrator access PIN and generate new PINs for studio operators.",
      },
      { property: "og:title", content: "Admin Profile — Dance Masterclass Admin" },
      {
        property: "og:description",
        content: "Administrator PIN settings for the studio operator application.",
      },
    ],
  }),
  loader: async () => {
    const status = await getGateStatus();
    return { username: status.username ?? "admin" };
  },
  component: AdminProfile,
});

function AdminProfile() {
  const { username } = Route.useLoaderData();
  const fetchOps = useServerFn(adminListOperators);
  const changeOwnPin = useServerFn(adminChangeOwnPin);
  const resetPin = useServerFn(adminResetOperatorPin);
  const [ownOpen, setOwnOpen] = useState(false);
  const [target, setTarget] = useState<OperatorBasic | null>(null);

  const { data: operators } = useQuery({
    queryKey: ["admin", "operators"],
    queryFn: () => fetchOps(),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{username}</span>
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Administrator PIN</h2>
            <p className="text-xs text-muted-foreground">
              Your PIN unlocks the admin application. It is stored hashed and never displayed.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="tracking-[0.4em] text-muted-foreground">••••</span>
            <Button size="sm" onClick={() => setOwnOpen(true)}>
              Change PIN
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Operator PINs</h2>
            <p className="text-xs text-muted-foreground">
              Generate a new PIN for an operator. Operators can only change their own PIN.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {(operators ?? []).map((o) => (
              <li key={o.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1 truncate text-sm">{o.username}</span>
                <Badge variant={o.is_active ? "secondary" : "outline"} className="text-[10px]">
                  {o.is_active ? "Active" : "Disabled"}
                </Badge>
                <span className="tracking-[0.3em] text-muted-foreground">••••</span>
                <Button size="sm" variant="outline" onClick={() => setTarget(o)}>
                  Generate PIN
                </Button>
              </li>
            ))}
            {(operators ?? []).length === 0 && (
              <li className="py-4 text-sm text-muted-foreground">No operators yet.</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <PinDialog
        open={ownOpen}
        title="Change administrator PIN"
        onOpenChange={setOwnOpen}
        onSubmit={async (pin) => {
          await changeOwnPin({ data: { pin } });
          setOwnOpen(false);
          toast.success("Admin PIN updated");
        }}
      />

      <PinDialog
        open={!!target}
        title={target ? `Generate PIN for ${target.username}` : ""}
        onOpenChange={(v) => !v && setTarget(null)}
        onSubmit={async (pin) => {
          if (!target) return;
          await resetPin({ data: { id: target.id, pin } });
          setTarget(null);
          toast.success("PIN updated");
        }}
      />
    </div>
  );
}
