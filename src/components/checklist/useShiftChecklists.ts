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
    setChecklists(
      snapshot
        ? pending.current.reduce(
            (cur, op) => setChecklistItemState(cur, op.target, op.itemId, op.completed),
            snapshot,
          )
        : null,
    );
  }, []);

  const refresh = useCallback(
    (id: string) => {
      const ticket = ++request.current;
      const version = revision.current;
      setLoading(true);
      read({ data: { shiftId: id } })
        .then((value) => {
          if (active.current !== id || ticket !== request.current || version !== revision.current)
            return;
          confirmed.current = value;
          project();
        })
        .catch(() => {
          if (active.current === id) toast.error("Could not load checklists");
        })
        .finally(() => {
          if (active.current === id && ticket === request.current) setLoading(false);
        });
    },
    [read, project],
  );

  useEffect(() => {
    if (loadedFor.current === shiftId) return;
    loadedFor.current = shiftId;
    confirmed.current = null;
    pending.current = [];
    setChecklists(null);
    if (shiftId) refresh(shiftId);
    else setLoading(false);
  }, [shiftId, refresh]);

  const sameTarget = (a: ChecklistTarget, b: ChecklistTarget) =>
    a.section === b.section &&
    (a.section !== "class" || b.section !== "class" || a.classId === b.classId);

  const toggleItem = useCallback(
    (target: ChecklistTarget, itemId: string, completed: boolean) => {
      if (!shiftId || !confirmed.current) return;
      const id = shiftId;
      const operation: Pending = { target, itemId, completed };
      pending.current.push(operation);
      project();
      queue.current = queue.current.then(async () => {
        const superseded = pending.current.some(
          (op) => op !== operation && sameTarget(op.target, target) && op.itemId === itemId,
        );
        // A newer click on the same item is already queued — its final state wins.
        if (!superseded && active.current === id) {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const saved = await write({
                data: {
                  shiftId: id,
                  section: target.section,
                  classId: target.section === "class" ? target.classId : null,
                  itemId,
                  completed,
                },
              });
              if (active.current === id) {
                confirmed.current = saved;
                revision.current++;
              }
              break;
            } catch (error) {
              if (attempt === 0) continue;
              // Never lock the checklist: reconcile with the server and keep going.
              toast.error("Unable to save checklist change. Retrying…");
              if (active.current === id) refresh(id);
              void error;
            }
          }
        }
        if (active.current === id) {
          pending.current = pending.current.filter((op) => op !== operation);
          project();
        }
      });
    },
    [shiftId, write, project, refresh],
  );

  return { checklists, loading, toggleItem, reload: () => shiftId && refresh(shiftId) };
}
