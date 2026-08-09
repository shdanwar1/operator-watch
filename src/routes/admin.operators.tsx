import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminCreateOperator,
  adminDeleteOperator,
  adminListOperators,
  adminResetOperatorPin,
  adminSetOperatorActive,
  adminUpdateOperator,
  type OperatorBasic,
} from "@/lib/operators.functions";
import { PIN_RE, USERNAME_RE } from "@/lib/validation";
import { opColor } from "@/lib/admin-utils";

export const Route = createFileRoute("/admin/operators")({
  head: () => ({
    meta: [
      { title: "Operators — Dance Masterclass Admin" },
      {
        name: "description",
        content: "Create, edit, enable or disable studio operators and reset their access PINs.",
      },
      { property: "og:title", content: "Operators — Dance Masterclass Admin" },
      {
        property: "og:description",
        content: "Manage studio operator accounts and access PINs.",
      },
    ],
  }),
  component: AdminOperators,
});

function AdminOperators() {
  const qc = useQueryClient();
  const fetchOps = useServerFn(adminListOperators);
  const createFn = useServerFn(adminCreateOperator);
  const updateFn = useServerFn(adminUpdateOperator);
  const activeFn = useServerFn(adminSetOperatorActive);
  const deleteFn = useServerFn(adminDeleteOperator);
  const resetPinFn = useServerFn(adminResetOperatorPin);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OperatorBasic | null>(null);
  const [resetting, setResetting] = useState<OperatorBasic | null>(null);
  const [deleting, setDeleting] = useState<OperatorBasic | null>(null);

  const { data: operators, isPending } = useQuery({
    queryKey: ["admin", "operators"],
    queryFn: () => fetchOps(),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "operators"] });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (operators ?? [])
      .filter((o) =>
        statusFilter === "all" ? true : statusFilter === "active" ? o.is_active : !o.is_active,
      )
      .filter((o) => (q ? o.username.toLowerCase().includes(q) : true));
  }, [operators, search, statusFilter]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operators</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Accounts, access and upcoming coverage.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> New operator
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search operators"
            className="h-9 w-64 pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Username</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Upcoming shifts</th>
                  <th className="px-4 py-3 font-medium">PIN</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {isPending && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!isPending && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No operators found.
                    </td>
                  </tr>
                )}
                {rows.map((o) => {
                  const c = opColor(o.username);
                  return (
                    <tr key={o.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${c?.dot}`} />
                          {o.username}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{o.username}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={o.is_active ? "secondary" : "outline"}
                          className="text-[10px]"
                        >
                          {o.is_active ? "Active" : "Disabled"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{o.future_shift_count}</td>
                      <td className="px-4 py-3 tracking-[0.3em] text-muted-foreground">••••</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setResetting(o)}>
                            Reset PIN
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              await activeFn({
                                data: { id: o.id, active: !o.is_active, unassign_future: false },
                              });
                              refresh();
                              toast.success(o.is_active ? "Operator disabled" : "Operator enabled");
                            }}
                          >
                            {o.is_active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => setDeleting(o)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <CreateOperatorDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (username, pin) => {
          await createFn({ data: { username, pin } });
          refresh();
          toast.success("Operator created");
        }}
      />

      <EditOperatorDialog
        operator={editing}
        onClose={() => setEditing(null)}
        onSave={async (username) => {
          if (!editing) return;
          await updateFn({ data: { id: editing.id, username } });
          setEditing(null);
          refresh();
          toast.success("Operator updated");
        }}
      />

      <PinDialog
        title={resetting ? `Reset PIN for ${resetting.username}` : ""}
        open={!!resetting}
        onOpenChange={(v) => !v && setResetting(null)}
        onSubmit={async (pin) => {
          if (!resetting) return;
          await resetPinFn({ data: { id: resetting.id, pin } });
          setResetting(null);
          toast.success("PIN reset");
        }}
      />

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.username}?</DialogTitle>
            <DialogDescription>
              Future assignments are released. Past shifts stay in payroll history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleting) return;
                try {
                  await deleteFn({ data: { id: deleting.id } });
                  setDeleting(null);
                  refresh();
                  toast.success("Operator deleted");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to delete");
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateOperatorDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (username: string, pin: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = USERNAME_RE.test(username) && PIN_RE.test(pin);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setUsername("");
          setPin("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New operator</DialogTitle>
          <DialogDescription>
            They complete their own profile on first sign-in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>4-digit PIN</Label>
            <Input
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onCreate(username, pin);
                onOpenChange(false);
                setUsername("");
                setPin("");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to create");
              } finally {
                setBusy(false);
              }
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditOperatorDialog({
  operator,
  onClose,
  onSave,
}: {
  operator: OperatorBasic | null;
  onClose: () => void;
  onSave: (username: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const key = operator?.id ?? "";
  useMemo(() => {
    if (operator) setUsername(operator.username);
    return key;
  }, [key]);

  if (!operator) return null;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit operator</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Username</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!USERNAME_RE.test(username)}
            onClick={async () => {
              try {
                await onSave(username);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to save");
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PinDialog({
  open,
  title,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  onOpenChange: (v: boolean) => void;
  onSubmit: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const valid = PIN_RE.test(pin) && pin === confirm;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setPin("");
          setConfirm("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Takes effect at the next sign-in.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>New PIN</Label>
            <Input
              type={show ? "text" : "password"}
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm PIN</Label>
            <Input
              type={show ? "text" : "password"}
              inputMode="numeric"
              maxLength={4}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={show} onCheckedChange={(v) => setShow(Boolean(v))} />
            Show PIN
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={async () => {
              try {
                await onSubmit(pin);
                setPin("");
                setConfirm("");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to set PIN");
              }
            }}
          >
            Save PIN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
