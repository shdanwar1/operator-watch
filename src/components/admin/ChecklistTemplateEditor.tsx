import { useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CLASS_HEADINGS,
  addItem,
  deleteItem,
  moveItem,
  moveItemDown,
  moveItemUp,
  supportsHeadings,
  updateItem,
  validateChecklistTemplate,
} from "@/domain/checklist-editor";
import type { ChecklistTemplate, ChecklistTemplateItem, ChecklistType } from "@/domain/checklists";

const NO_HEADING = "__none__";

/**
 * One master checklist editor. Everything is local draft state — nothing is
 * written until Save, and a failed save keeps the dialog and the draft.
 */
export function ChecklistTemplateEditor({
  open,
  type,
  template,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  type: ChecklistType;
  template: ChecklistTemplate;
  onOpenChange: (open: boolean) => void;
  onSave: (items: ChecklistTemplateItem[]) => Promise<void>;
}) {
  const [items, setItems] = useState<ChecklistTemplateItem[]>(template.items);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ChecklistTemplateItem | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [newText, setNewText] = useState("");
  const [newHeading, setNewHeading] = useState<string>(NO_HEADING);
  const headings = supportsHeadings(type);

  const reset = () => {
    setItems(template.items);
    setError(null);
    setNewText("");
    setNewHeading(NO_HEADING);
    setDragIndex(null);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const handleAdd = () => {
    const text = newText.trim();
    if (!text) return;
    setItems((prev) =>
      addItem(type, prev, {
        text,
        heading: headings && newHeading !== NO_HEADING ? newHeading : null,
      }),
    );
    setNewText("");
  };

  const handleSave = async () => {
    setError(null);
    try {
      validateChecklistTemplate(type, { title: template.title, items });
    } catch (e) {
      setError(e instanceof Error ? e.message : "This checklist is not valid");
      return;
    }
    setSaving(true);
    try {
      await onSave(items);
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this checklist. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">{template.title}</DialogTitle>
          <DialogDescription className="text-xs">
            {items.length} items · drag or use the arrows to reorder
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] overflow-y-auto px-5 py-3">
          <ul className="divide-y divide-border">
            {items.map((item, index) => (
              <li
                key={item.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) setItems((prev) => moveItem(prev, dragIndex, index));
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className="flex items-center gap-2 py-1.5"
              >
                <span
                  aria-hidden
                  className="cursor-grab text-muted-foreground active:cursor-grabbing"
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <Input
                  value={item.text}
                  aria-label={`Item ${index + 1} text`}
                  onChange={(e) =>
                    setItems((prev) => updateItem(prev, item.id, { text: e.target.value }))
                  }
                  className="h-8 min-w-0 flex-1 text-sm"
                />
                {headings && (
                  <Select
                    value={item.heading ?? NO_HEADING}
                    onValueChange={(v) =>
                      setItems((prev) =>
                        updateItem(prev, item.id, { heading: v === NO_HEADING ? null : v }),
                      )
                    }
                  >
                    <SelectTrigger
                      aria-label={`Item ${index + 1} heading`}
                      className="h-8 w-[172px] shrink-0 text-xs max-sm:hidden"
                    >
                      <SelectValue placeholder="No heading" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_HEADING}>No heading</SelectItem>
                      {CLASS_HEADINGS.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Move item ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => setItems((prev) => moveItemUp(prev, index))}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Move item ${index + 1} down`}
                    disabled={index === items.length - 1}
                    onClick={() => setItems((prev) => moveItemDown(prev, index))}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete item ${index + 1}`}
                    onClick={() => setPendingDelete(item)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2 border-t border-border px-5 py-3">
          <Label htmlFor="new-item-text" className="text-xs text-muted-foreground">
            Add item
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="new-item-text"
              value={newText}
              placeholder="Item text"
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              className="h-8 min-w-[200px] flex-1 text-sm"
            />
            {headings && (
              <Select value={newHeading} onValueChange={setNewHeading}>
                <SelectTrigger aria-label="New item heading" className="h-8 w-[172px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_HEADING}>No heading</SelectItem>
                  {CLASS_HEADINGS.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleAdd}
              disabled={!newText.trim()}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Item
            </Button>
          </div>
        </div>

        {error && (
          <p role="alert" className="px-5 pb-1 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this checklist item?</AlertDialogTitle>
            <AlertDialogDescription>{pendingDelete?.text}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) setItems((prev) => deleteItem(prev, pendingDelete.id));
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
