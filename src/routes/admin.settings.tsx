import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  getAppSettings,
  adminUpdateCheckoutSetting,
  adminUpdateStudioSetting,
} from "@/lib/settings.functions";
import {
  adminCreateDirectoryItem,
  adminDeleteDirectoryItem,
  adminRenameDirectoryItem,
  findPossibleDuplicates,
  listClasses,
  listTeachers,
  type DirectoryItem,
} from "@/lib/directories.functions";
import { backfillClassMatches } from "@/lib/gcal.functions";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "App Settings — Dance Masterclass Admin" },
      {
        name: "description",
        content: "System-wide studio address, class and teacher directories and operator check-out reminders.",
      },
      { property: "og:title", content: "App Settings — Dance Masterclass Admin" },
      {
        property: "og:description",
        content: "System-wide configuration for the studio operator application.",
      },
    ],
  }),
  component: AdminSettings,
});

function AdminSettings() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">App Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          These settings apply to the whole application, for every operator.
        </p>
      </header>
      <StudioSection />
      <CheckoutSection />
      <div className="grid gap-6 lg:grid-cols-2">
        <DirectorySection table="classes" title="Classes" />
        <DirectorySection table="teachers" title="Teachers" />
      </div>
      <MaintenanceSection />
    </div>
  );
}

function StudioSection() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getAppSettings);
  const saveFn = useServerFn(adminUpdateStudioSetting);
  const { data } = useQuery({ queryKey: ["app-settings"], queryFn: () => fetchSettings() });
  const [draft, setDraft] = useState<{ label: string; lat: string; lng: string } | null>(null);

  const current = draft ?? {
    label: data?.studio.label ?? "",
    lat: String(data?.studio.lat ?? ""),
    lng: String(data?.studio.lng ?? ""),
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Studio address</h2>
          <p className="text-xs text-muted-foreground">
            Used as the destination for every operator's “Time to leave” estimate.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input
              value={current.label}
              onChange={(e) => setDraft({ ...current, label: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Latitude</Label>
            <Input
              value={current.lat}
              onChange={(e) => setDraft({ ...current, lat: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Longitude</Label>
            <Input
              value={current.lng}
              onChange={(e) => setDraft({ ...current, lng: e.target.value })}
            />
          </div>
        </div>
        <Button
          size="sm"
          onClick={async () => {
            try {
              await saveFn({
                data: {
                  label: current.label,
                  lat: Number(current.lat),
                  lng: Number(current.lng),
                },
              });
              setDraft(null);
              qc.invalidateQueries({ queryKey: ["app-settings"] });
              toast.success("Studio address saved");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to save");
            }
          }}
        >
          Save studio
        </Button>
      </CardContent>
    </Card>
  );
}

function CheckoutSection() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getAppSettings);
  const saveFn = useServerFn(adminUpdateCheckoutSetting);
  const { data } = useQuery({ queryKey: ["app-settings"], queryFn: () => fetchSettings() });
  const [msg, setMsg] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const message = msg ?? data?.checkout.message ?? "";
  const on = enabled ?? data?.checkout.enabled ?? true;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Check-out confirmation</h2>
            <p className="text-xs text-muted-foreground">
              Every operator must confirm this before their shift is closed.
            </p>
          </div>
          <Switch checked={on} onCheckedChange={(v) => setEnabled(v)} />
        </div>
        <Textarea rows={2} value={message} onChange={(e) => setMsg(e.target.value)} />
        <Button
          size="sm"
          onClick={async () => {
            try {
              await saveFn({ data: { message, enabled: on } });
              setMsg(null);
              setEnabled(null);
              qc.invalidateQueries({ queryKey: ["app-settings"] });
              toast.success("Check-out reminder saved");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to save");
            }
          }}
        >
          Save reminder
        </Button>
      </CardContent>
    </Card>
  );
}

function DirectorySection({ table, title }: { table: "classes" | "teachers"; title: string }) {
  const qc = useQueryClient();
  const fetchFn = useServerFn(table === "classes" ? listClasses : listTeachers);
  const createFn = useServerFn(adminCreateDirectoryItem);
  const renameFn = useServerFn(adminRenameDirectoryItem);
  const deleteFn = useServerFn(adminDeleteDirectoryItem);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const { data } = useQuery({ queryKey: ["directory", table], queryFn: () => fetchFn() });
  const items = (data ?? []) as DirectoryItem[];
  const refresh = () => qc.invalidateQueries({ queryKey: ["directory", table] });

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Add ${title.toLowerCase().slice(0, -2)}…`}
            className="h-9"
          />
          <Button
            size="sm"
            disabled={!name.trim()}
            onClick={async () => {
              try {
                await createFn({ data: { table, name } });
                setName("");
                refresh();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to add");
              }
            }}
          >
            Add
          </Button>
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/50">
              {editingId === it.id ? (
                <>
                  <Input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="h-8"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await renameFn({ data: { table, id: it.id, name: editingName } });
                      setEditingId(null);
                      refresh();
                    }}
                  >
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">{it.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {it.usage_count}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(it.id);
                      setEditingName(it.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={async () => {
                      await deleteFn({ data: { table, id: it.id } });
                      refresh();
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-2 py-4 text-sm text-muted-foreground">Nothing here yet.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function MaintenanceSection() {
  const backfillFn = useServerFn(backfillClassMatches);
  const dupFn = useServerFn(findPossibleDuplicates);
  const [busy, setBusy] = useState(false);
  const { data: dups, refetch } = useQuery({
    queryKey: ["admin", "duplicates"],
    queryFn: () => dupFn(),
  });

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Data maintenance</h2>
          <p className="text-xs text-muted-foreground">
            Re-run class and teacher matching, and review possible duplicate directory entries.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await backfillFn();
                toast.success(`Re-checked ${res.updated ?? 0} classes`);
                refetch();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Re-checking…" : "Re-check class & teacher matches"}
          </Button>
        </div>
        {(dups ?? []).length > 0 && (
          <div className="space-y-1 rounded-lg border border-border p-3 text-xs">
            <div className="font-medium">Possible duplicates</div>
            {(dups ?? []).slice(0, 20).map((p, i) => (
              <div key={i} className="text-muted-foreground">
                {p.a.name} ↔ {p.b.name}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
