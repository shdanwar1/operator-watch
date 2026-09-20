import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getMyShiftChecklists, setMyChecklistItem } from "@/lib/checklists.functions";
import { setChecklistItemState, type ShiftChecklists } from "@/domain/checklists";

export type ChecklistTarget =
  | { section: "start" }
  | { section: "end" }
  | { section: "class"; classId: string };
type Pending = { target: ChecklistTarget; itemId: string; completed: boolean };

/** One server mutation per click, ordered locally; no polling or background reads. */
export function useShiftChecklists(shiftId: string | null) {
  const read = useServerFn(getMyShiftChecklists);
  const write = useServerFn(setMyChecklistItem);
  const [checklists, setChecklists] = useState<ShiftChecklists | null>(null);
  const [loading, setLoading] = useState(false);
  const active = useRef(shiftId);
  active.current = shiftId;
  const confirmed = useRef<ShiftChecklists | null>(null);
  const pending = useRef<Pending[]>([]);
  const queue = useRef(Promise.resolve());
  const loadedFor = useRef<string | null>(null);
  const request = useRef(0);
  const revision = useRef(0);

  const project = useCallback(() => {
    const snapshot = confirmed.current;
    setChecklists(snapshot ? pending.current.reduce((cur, op) =>
      setChecklistItemState(cur, op.target, op.itemId, op.completed), snapshot) : null);
  }, []);

  const refresh = useCallback((id: string) => {
    const ticket = ++request.current;
    const version = revision.current;
    setLoading(true);
    read({ data: { shiftId: id } }).then((value) => {
      if (active.current !== id || ticket !== request.current || version !== revision.current) return;
      confirmed.current = value;
      project();
    }).catch(() => {
      if (active.current === id) toast.error("Could not load checklists");
    }).finally(() => {
      if (active.current === id && ticket === request.current) setLoading(false);
    });
  }, [read, project]);

  useEffect(() => {
    if (loadedFor.current === shiftId) return;
    loadedFor.current = shiftId;
    confirmed.current = null;
    pending.current = [];
    setChecklists(null);
    if (shiftId) refresh(shiftId);
    else setLoading(false);
  }, [shiftId, refresh]);

  const toggleItem = useCallback((target: ChecklistTarget, itemId: string, completed: boolean) => {
    if (!shiftId || !confirmed.current) return;
    const id = shiftId;
    const operation = { target, itemId, completed };
    pending.current.push(operation);
    project();
    queue.current = queue.current.then(async () => {
      try {
        const saved = await write({ data: {
          shiftId: id, section: target.section,
          classId: target.section === "class" ? target.classId : null, itemId, completed,
        } });
        if (active.current === id) {
          confirmed.current = saved;
          revision.current++;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save the checklist item");
      } finally {
        if (active.current === id) {
          pending.current = pending.current.filter((op) => op !== operation);
          project();
        }
      }
    });
  }, [shiftId, write, project]);

  return { checklists, loading, toggleItem, reload: () => shiftId && refresh(shiftId) };
}
