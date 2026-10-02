import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import {
  captureAutoCheckInIntent,
  storeAutoCheckInIntent,
} from "../lib/auto-checkin-intent";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Studio Operator Suite" },
      { name: "description", content: "Check in and out of live stream studio shifts and log streams managed and dance teachers encountered." },
      { property: "og:title", content: "Studio Operator Suite" },
      { property: "og:description", content: "Check in and out of live stream studio shifts and log streams managed and dance teachers encountered." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Studio Operator Suite" },
      { name: "twitter:description", content: "Check in and out of live stream studio shifts and log streams managed and dance teachers encountered." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/5b1a5f59-430d-483a-8c24-9b701219e3cf" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/5b1a5f59-430d-483a-8c24-9b701219e3cf" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('theme');if(!t)t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    // The inline script below sets `class="dark"` on <html> before hydration to
    // avoid a light flash. The server cannot know the stored theme, so React
    // would report a hydration mismatch on this element every load.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // The "Shift starting now" tap arrives as ?autoCheckIn=<id>. It is captured
  // here, on whatever route the app lands on, because signing in redirects
  // through /unlock and would otherwise discard it. The dashboard consumes it
  // once the operator session exists.
  useEffect(() => {
    captureAutoCheckInIntent();

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; scheduledShiftId?: string } | null;
      if (!data || data.type !== "shift_start_check_in" || !data.scheduledShiftId) return;
      storeAutoCheckInIntent(data.scheduledShiftId);
      // Already-open app: land on the dashboard so the intent is acted on.
      if (window.location.pathname !== "/") window.location.assign("/");
      else window.dispatchEvent(new Event("auto-checkin-intent"));
    };

    navigator.serviceWorker?.addEventListener("message", onMessage);
    // addEventListener alone leaves the client message queue disabled, so
    // messages the service worker posts on a notification tap never arrive.
    navigator.serviceWorker?.startMessages?.();
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
