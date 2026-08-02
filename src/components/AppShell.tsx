import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Monitor,
  PanelLeft,
  User,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

const NAV: { label: string; to: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard, exact: true },
  { label: "Calendar", to: "/calendar", icon: CalendarDays },
  { label: "Shifts", to: "/shifts", icon: ListChecks },
  { label: "Attendance", to: "/earnings", icon: ClipboardList },
  { label: "Studio Display", to: "/display", icon: Monitor },
  { label: "Profile", to: "/profile", icon: User },
];


export const STUDIO_NAME = "DMC Studio";

/**
 * The single application frame: persistent sidebar, minimal top bar, and a
 * 1600px content column. Every operator screen renders inside this.
 */
export function AppShell({
  username,
  onAir = false,
  onSignOut,
  children,
}: {
  username: string | null;
  onAir?: boolean;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-out lg:flex",
          collapsed ? "w-[68px]" : "w-[232px]",
        )}
      >
        <div className={cn("flex h-16 items-center px-4", collapsed && "justify-center px-0")}>
          <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent">
              <Monitor className="h-4 w-4" />
            </span>
            {!collapsed && (
              <span className="truncate text-[13px] font-semibold leading-tight tracking-tight">
                Studio
                <br />
                Operator
              </span>
            )}
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-4">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.to
              : pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "press flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="px-2 pb-4">
          <button
            type="button"
            onClick={onSignOut}
            className={cn(
              "press flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-6 backdrop-blur-sm lg:px-8">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label="Toggle navigation"
            className="press hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground lg:block"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium tracking-tight">{STUDIO_NAME}</span>

          <div className="ml-auto flex items-center gap-4">
            {onAir && (
              <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-done">
                <span className="status-dot bg-done" />
                On air
              </span>
            )}
            {username && (
              <Link
                to="/profile"
                className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {username}
              </Link>
            )}
            <ThemeToggle className="h-8 w-8" />
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Log out"
              title="Log out"
              className="press rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1600px] px-6 py-8 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Section heading used across every screen. */
export function SectionTitle({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-medium tracking-tight">{title}</h2>
        {meta && <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>}
      </div>
      {action}
    </div>
  );
}
