import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChecklistTemplateEditor } from "./ChecklistTemplateEditor";
import {
  adminGetChecklistTemplates,
  adminUpdateChecklistTemplate,
} from "@/lib/checklist-templates.functions";
import { CHECKLIST_TYPES } from "@/domain/checklist-editor";
import type { ChecklistType } from "@/domain/checklists";

/** The four master checklists with their item counts and an editor each. */
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
    <div className="divide-y divide-border rounded-lg border border-border">
      {CHECKLIST_TYPES.map((type) => {
        const template = config[type];
        return (
          <div key={type} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{template.title}</p>
              <p className="text-xs text-muted-foreground">{template.items.length} items</p>
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
