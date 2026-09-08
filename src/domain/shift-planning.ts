/**
 * Canonical shift planning rules (Operation 4).
 *
 * The implementation stays exactly where it has always been
 * (`gcal-core.groupClassesIntoShifts`) — this module only gives the rule a
 * domain-level home so Google Calendar reads as a *caller* of the rule rather
 * than its owner. Same function, same buffers, same output:
 *
 *   shift start = first class start − 30 minutes
 *   shift end   = last class end   + 15 minutes
 *   classes closer than the gap threshold belong to one shift
 */
export {
  groupClassesIntoShifts,
  SHIFT_CONFIG,
  type ClassEvent,
  type GroupedShift,
} from "@/lib/gcal-core";
