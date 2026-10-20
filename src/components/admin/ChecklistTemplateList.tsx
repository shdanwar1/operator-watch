import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, PersonStanding, Dumbbell, MoonStar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChecklistTemplateEditor } from "./ChecklistTemplateEditor";
import {
  adminGetChecklistTemplates,
  adminUpdateChecklistTemplate,
} from "@/lib/checklist-templates.functions";
import { CHECKLIST_TYPES } from "@/domain/checklist-editor";
import type { ChecklistType } from "@/domain/checklists";

const TYPE_PRESENTATION: Record<
  ChecklistType,
  { icon: typeof ClipboardList; iconClass: string; label: string }
> = {
  start_shift: {
    icon: ClipboardList,
    iconClass: "bg-sky-500/15 text-sky-500",
    label: "Start Shift",
  },
  ballet: {
    icon: PersonStanding,
    iconClass: "bg-violet-500/15 text-violet-500",
    label: "Ballet",
  },
  workout: {
    icon: Dumbbell,
    iconClass: "bg-amber-500/15 text-amber-500",
    label: "Workout",
  },
  end_shift: {
    icon: MoonStar,
    iconClass: "bg-teal-500/15 text-teal-500",
    label: "End Shift",
  },
};

/** The four master checklists as cards with their item counts and an editor each. */
export function ChecklistTemplateList() {
  const fetchTemplates = useServerFn(adminGetChecklistTemplates);
  const saveTemplate = useServerFn(adminUpdateChecklistTemplate);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ChecklistType | null>(null);

  const query = useQuery({
    queryKey: ["admin", "checklist-templates"],
    queryFn: () => fetchTemplates({ data: undefined as never }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (query.isError) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>Could not load the checklists.</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!query.data) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading checklists…
      </p>
    );
  }

  const config = query.data;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {CHECKLIST_TYPES.map((type) => {
        const template = config[type];
        const { icon: Icon, iconClass, label } = TYPE_PRESENTATION[type];
        return (
          <div
            key={type}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5"
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{label}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {template.items.length} items
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(type)}>
              Edit / Reorder
            </Button>
            {editing === type && (
              <ChecklistTemplateEditor
                open
                type={type}
                template={template}
                onOpenChange={(open) => {
                  if (!open) setEditing(null);
                }}
                onSave={async (items) => {
                  const next = await saveTemplate({
                    data: { type, title: template.title, items },
                  });
                  queryClient.setQueryData(["admin", "checklist-templates"], next);
                  toast.success(`${template.title} saved`);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
