import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  LayoutDashboard,
  ListChecks,
  LogOut,
  PanelLeft,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { signOutUser } from "@/lib/gate.functions";
import { cn } from "@/lib/utils";

/**
 * The Admin application frame. Completely separate from the operator
 * AppShell: different navigation, different routes, no operator features.
 */
const ADMIN_NAV: { label: string; to: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { label: "Dashboard", to: "/admin", icon: LayoutDashboard, exact: true },
  { label: "Calendar", to: "/admin/calendar", icon: CalendarDays },
  { label: "Shifts", to: "/admin/shifts", icon: ListChecks },
  { label: "Operators", to: "/admin/operators", icon: Users },
  { label: "Settings", to: "/admin/settings", icon: Settings },
];

const COLLAPSE_KEY = "so.admin.sidebar.collapsed";

export function AdminShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const signOut = useServerFn(signOutUser);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleSignOut = async () => {
    await signOut();
    await router.navigate({ to: "/unlock" });
  };

  const isActive = (item: (typeof ADMIN_NAV)[number]) =>
    item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-out lg:flex",
          collapsed ? "w-[68px]" : "w-[232px]",
        )}
      >
        <div className={cn("flex h-16 items-center px-4", collapsed && "justify-center px-0")}>
          <Link to="/admin" className="flex items-center gap-2.5 overflow-hidden">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent">
              <Shield className="h-4 w-4" />
            </span>
            {!collapsed && (
              <span className="truncate text-[13px] font-semibold leading-tight tracking-tight">
                Studio
                <br />
                Admin
              </span>
            )}
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-4">
          {ADMIN_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              className={cn(
                "press flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors",
                collapsed && "justify-center px-0",
                isActive(item)
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="border-t border-sidebar-border px-2 py-3">
          <button
            type="button"
            onClick={handleSignOut}
            title={collapsed ? "Logout" : undefined}
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
            onClick={toggleCollapsed}
            aria-label="Toggle navigation"
            className="press hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground lg:block"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium tracking-tight">Administration</span>
          <div className="ml-auto flex items-center gap-4">
            <ThemeToggle className="h-8 w-8" />
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 lg:hidden">
          {ADMIN_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-xs transition-colors",
                isActive(item)
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={handleSignOut}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs text-muted-foreground"
          >
            Logout
          </button>
        </nav>

        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1600px] px-6 py-8 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
