import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getGateStatus } from "@/lib/gate.functions";
import { adminListShifts } from "@/lib/operators.functions";
import type { ShiftRow } from "@/lib/shifts.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast, Toaster } from "sonner";
import { ArrowLeft, LogIn, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const { unlocked } = await getGateStatus();
    if (!unlocked) throw redirect({ to: "/unlock" });
  },
  head: () => ({
    meta: [
      { title: "Admin — all shifts" },
      { name: "description", content: "Admin dashboard showing every operator's shifts." },
    ],
  }),
  component: AdminPage,
});

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function duration(a: string, b: string | null) {
  const end = b ? new Date(b).getTime() : Date.now();
  const mins = Math.max(0, Math.floor((end - new Date(a).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return `${h}h ${(mins % 60).toString().padStart(2, "0")}m`;
}

function AdminPage() {
  const fetchAdminShifts = useServerFn(adminListShifts);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);
  const [filter, setFilter] = useState<string>("all");

  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const rows = await fetchAdminShifts({ data: { username, password } });
      setShifts(rows as ShiftRow[]);
      toast.success("Admin access granted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Access denied");
    } finally {
      setLoading(false);
    }
  }

  const operators = useMemo(() => {
    if (!shifts) return [];
    return Array.from(new Set(shifts.map((s) => s.operator_name))).sort();
  }, [shifts]);

  const filtered = useMemo(() => {
    if (!shifts) return [];
    return filter === "all" ? shifts : shifts.filter((s) => s.operator_name === filter);
  }, [shifts, filter]);

  const summary = useMemo(() => {
    if (!shifts) return null;
    const byOp = new Map<string, { count: number; minutes: number }>();
    for (const s of shifts) {
      const cur = byOp.get(s.operator_name) ?? { count: 0, minutes: 0 };
      cur.count += 1;
      const end = s.check_out_at ? new Date(s.check_out_at).getTime() : Date.now();
      cur.minutes += Math.max(0, Math.floor((end - new Date(s.check_in_at).getTime()) / 60000));
      byOp.set(s.operator_name, cur);
    }
    return byOp;
  }, [shifts]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-center" />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" /> Home
            </Link>
          </Button>
          <div className="ml-1 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Admin view</h1>
              <p className="text-xs text-muted-foreground">All operators, all shifts.</p>
            </div>
          </div>
        </header>

        {!shifts ? (
          <Card className="mx-auto max-w-sm">
            <CardContent className="space-y-4 p-6">
              <p className="text-sm text-muted-foreground">
                Sign in with an admin operator account to view every operator's shifts.
              </p>
              <form onSubmit={login} className="space-y-4">
                <div className="space-y-2">
                  <Label>Admin username</Label>
                  <Input
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  <LogIn className="mr-2 h-4 w-4" />
                  {loading ? "Signing in…" : "Sign in as admin"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {summary && summary.size > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from(summary.entries())
                  .sort((a, b) => b[1].minutes - a[1].minutes)
                  .map(([op, s]) => (
                    <Card key={op}>
                      <CardContent className="flex items-center justify-between p-4">
                        <div>
                          <div className="text-sm font-medium">{op}</div>
                          <div className="text-xs text-muted-foreground">
                            {s.count} shift{s.count === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold tabular-nums">
                            {Math.floor(s.minutes / 60)}h {(s.minutes % 60).toString().padStart(2, "0")}m
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Filter:</span>
              <Button
                variant={filter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("all")}
              >
                All ({shifts.length})
              </Button>
              {operators.map((op) => (
                <Button
                  key={op}
                  variant={filter === op ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(op)}
                >
                  {op}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground">No shifts.</p>
              ) : (
                filtered.map((s) => (
                  <Card key={s.id}>
                    <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{s.operator_name}</span>
                          {!s.check_out_at && (
                            <Badge variant="destructive" className="text-[10px]">
                              ACTIVE
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[10px]">
                            {s.classes.length} class{s.classes.length === 1 ? "" : "es"}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {fmt(s.check_in_at)} → {fmt(s.check_out_at)} ·{" "}
                          {duration(s.check_in_at, s.check_out_at)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
