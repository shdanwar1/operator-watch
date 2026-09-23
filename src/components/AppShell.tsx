import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Monitor,
  PanelLeft,
  User,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PushBinding } from "@/components/PushBinding";
import { signOutUser } from "@/lib/gate.functions";
import { releasePushEndpoint } from "@/lib/push.functions";
import { unsubscribeFromPush } from "@/lib/push-client";
import { clearAllCaches } from "@/lib/local-cache";
import { cn } from "@/lib/utils";

const NAV: { label: string; to: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard, exact: true },
  { label: "Calendar", to: "/calendar", icon: CalendarDays },
  { label: "Records", to: "/record", icon: ListChecks },
];

/** Desktop sidebar: the four primary destinations plus Studio Display. */
const SIDEBAR_NAV = [
  ...NAV,
  { label: "Display", to: "/studio-display", icon: Monitor },
];

/** Mobile tab bar: the three primary destinations plus Display and Profile. */
const MOBILE_NAV = [
  ...NAV,
  { label: "Display", to: "/studio-display", icon: Monitor },
  { label: "Profile", to: "/profile", icon: User },
];

const COLLAPSE_KEY = "so.sidebar.collapsed";



export const STUDIO_NAME = "DMC Studio";

/**
 * The single application frame: persistent sidebar, minimal top bar, and a
 * 1600px content column. Every operator screen renders inside this.
 */
export function AppShell({
  onAir = false,
  children,
}: {
  /** Kept for API compatibility; the top bar no longer shows the name. */
  username?: string | null;
  onAir?: boolean;
  onSignOut?: () => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const signOut = useServerFn(signOutUser);
  const releaseEndpoint = useServerFn(releasePushEndpoint);

  // Restore after hydration so server and client markup match.
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
    clearAllCaches();
    // A push endpoint must never outlive the session that created it: the next
    // operator on this browser would otherwise inherit these reminders.
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) await releaseEndpoint({ data: { endpoint } });
    } catch {
      /* ignore — sign-out must proceed regardless */
    }
    await signOut();
    await router.navigate({ to: "/unlock" });
  };

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <PushBinding />
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
          {SIDEBAR_NAV.map((item) => {
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

        <div className="space-y-0.5 px-2 py-3">
          <Link
            to="/profile"
            title={collapsed ? "Profile" : undefined}
            className={cn(
              "press flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors",
              collapsed && "justify-center px-0",
              pathname === "/profile"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <User className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Profile</span>}
          </Link>
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
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-6 backdrop-blur-sm max-lg:glass-bar max-lg:h-14 max-lg:px-4 lg:px-8">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Toggle navigation"
            className="press hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground lg:block"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <span className="flex items-center gap-2 lg:hidden">
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-muted/60">
              <Monitor className="h-3.5 w-3.5" />
            </span>
          </span>

          <div className="ml-auto flex items-center gap-4 max-lg:gap-1.5">
            {onAir && (
              <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-done">
                <span className="status-dot bg-done" />
                On air
              </span>
            )}
            <ThemeToggle className="h-8 w-8 max-lg:h-9 max-lg:w-9" />
          </div>
        </header>

        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1600px] px-6 py-8 max-lg:px-4 max-lg:pb-28 max-lg:pt-5 lg:px-8">
            {children}
          </div>
        </main>

        {/* Mobile tab bar — flush with the bottom edge, thin top border. */}
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border glass-bar pb-safe lg:hidden">
          <div className="flex overflow-x-auto px-1.5 pb-1.5 pt-1">
            {MOBILE_NAV.map((item) => {
              const active = item.exact
                ? pathname === item.to
                : pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "press flex h-[52px] min-w-[68px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-9 items-center justify-center rounded-[11px] transition-colors",
                      active && "bg-sidebar-accent",
                    )}
                  >
                    <item.icon
                      className="h-[22px] w-[22px]"
                      strokeWidth={active ? 2 : 1.7}
                    />
                  </span>
                  <span className="text-[9.5px] font-medium leading-none">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
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

/** Page-level heading used at the top of each screen's content column. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  /** Small uppercase kicker above the title. */
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[26px] font-semibold leading-none tracking-tight max-lg:text-[32px] max-lg:tracking-[-0.045em]">
          {title}
        </h1>

        {subtitle && <p className="mt-1.5 text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
