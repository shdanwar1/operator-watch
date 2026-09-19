import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getMyShiftChecklists, setMyChecklistItem } from "@/lib/checklists.functions";
import {
  setChecklistItemState,
  type ShiftChecklists,
} from "@/domain/checklists";

export type ChecklistTarget =
  | { section: "start" }
  | { section: "end" }
  | { section: "class"; classId: string };

/**
 * Loads the operator's checklist snapshot once per shift and applies optimistic
 * item toggles. No polling, no realtime — the snapshot only changes here.
 */
export function useShiftChecklists(shiftId: string | null) {
  const read = useServerFn(getMyShiftChecklists);
  const write = useServerFn(setMyChecklistItem);
  const [checklists, setChecklists] = useState<ShiftChecklists | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedFor = useRef<string | null>(null);

  const refresh = useCallback(
    (id: string) => {
      setLoading(true);
      read({ data: { shiftId: id } })
        .then((v) => setChecklists(v))
        .catch(() => setChecklists(null))
        .finally(() => setLoading(false));
    },
    [read],
  );

  useEffect(() => {
    if (!shiftId) {
      setChecklists(null);
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === shiftId) return;
    loadedFor.current = shiftId;
    refresh(shiftId);
  }, [shiftId, refresh]);

  const toggleItem = useCallback(
    (target: ChecklistTarget, itemId: string, completed: boolean) => {
      if (!shiftId) return;
      let previous: ShiftChecklists | null = null;
      setChecklists((cur) => {
        if (!cur) return cur;
        previous = cur;
        return setChecklistItemState(cur, target, itemId, completed);
      });

      write({
        data: {
          shiftId,
          section: target.section,
          classId: target.section === "class" ? target.classId : null,
          itemId,
          completed,
        },
      }).catch((e: unknown) => {
        // Roll the single item back; other progress stays untouched.
        setChecklists((cur) =>
          cur ? setChecklistItemState(cur, target, itemId, !completed) : previous,
        );
        toast.error(e instanceof Error ? e.message : "Could not save the checklist item");
      });
    },
    [shiftId, write],
  );

  return { checklists, loading, toggleItem, reload: () => shiftId && refresh(shiftId) };
}
