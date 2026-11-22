import { useEffect, useState } from "react";
import { Share, X, PlusSquare } from "lucide-react";

const KEY = "dmc.installTip.dismissed";

/** iPhone Safari only: explains Share → Add to Home Screen. Hidden once installed. */
export function InstallTip() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const ua = navigator.userAgent;
      const ios = /iPhone|iPod/.test(ua) || (/iPad/.test(ua));
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const inFrame = window.self !== window.top;
      setShow(ios && !standalone && !inFrame && localStorage.getItem(KEY) !== "1");
    } catch {
      /* ignore */
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };

  return (
    <div className="glass mb-5 flex items-start gap-3 rounded-2xl p-4 lg:hidden" role="note">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
        <PlusSquare className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">Install DMC Studio</p>
        <p className="mt-0.5 text-muted-foreground">
          Tap <Share className="inline h-4 w-4 align-[-3px]" aria-label="Share" /> then{" "}
          <span className="font-medium text-foreground">Add to Home Screen</span> for full-screen use and shift alerts.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground touch-manipulation"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
