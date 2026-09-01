/**
 * Centralized page/document titles.
 *
 * Rule: use the shortest clear name that identifies the page. Admin pages get
 * an explicit " - Admin" suffix only where the same page name also exists on
 * the operator side.
 */
export const PAGE_TITLES = {
  dashboard: "Dashboard",
  calendar: "Calendar",
  shifts: "Shifts",
  attendance: "Attendance",
  record: "Record",
  profile: "Profile",
  chat: "Chat",
  adminCalendar: "Calendar - Admin",
  adminShifts: "Shifts - Admin",
  operators: "Operators",
  settings: "Settings",
  studioDisplay: "Studio Display",
} as const;

export type PageTitle = (typeof PAGE_TITLES)[keyof typeof PAGE_TITLES];

/** Builds the standard meta set for a page: one title, one description. */
export function pageMeta(title: string, description: string) {
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ];
}
