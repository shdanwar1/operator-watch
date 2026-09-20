import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ChecklistRecords } from "@/components/admin/ChecklistRecords";
import { adminListChecklistRecords } from "@/lib/checklist-records.functions";
import { filterChecklistRecords } from "@/lib/checklist-records";
import { berlinDateKey } from "@/lib/gcal-core";
import { pageMeta } from "@/lib/page-titles";

export const Route = createFileRoute("/admin/checklists")({
  head: () => ({
    meta: pageMeta(
      "Checklist Records — Studio Admin",
      "Read-only shift checklist records and Berlin completion times for Studio administrators.",
    ),
  }),
  component: AdminChecklists,
});

function AdminChecklists() {
  const [date, setDate] = useState(() => berlinDateKey(new Date()));
  const [operator, setOperator] = useState("all");
  const fetchRecords = useServerFn(adminListChecklistRecords);
  const query = useQuery({
    queryKey: ["admin", "checklist-records", date],
    queryFn: () => fetchRecords({ data: { date } }),
    enabled: Boolean(date),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const rows = filterChecklistRecords(query.data ?? [], operator);
  const operators = Array.from(new Set((query.data ?? []).map((row) => row.operator_name))).sort();
  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Checklists</h1>
      <h2 className="text-sm font-semibold uppercase text-muted-foreground">Checklist Records</h2>
      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <Label htmlFor="record-date">Date</Label>
          <Input
            id="record-date"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setOperator("all");
            }}
          />
        </div>
        <div className="min-w-40 space-y-2">
          <Label htmlFor="record-operator">Operator</Label>
          <Select value={operator} onValueChange={setOperator}>
            <SelectTrigger id="record-operator">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All operators</SelectItem>
              {operators.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Shifts</h3>
      {query.isError ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>Could not load checklist records.</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : query.isPending && date ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading records…
        </p>
      ) : rows.length ? (
        <ChecklistRecords records={rows} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {operator === "all" ? "No checklist records found." : "No matching checklist records."}
        </p>
      )}
    </section>
  );
}
