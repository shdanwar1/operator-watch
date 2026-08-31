import { useEffect, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import guide from "@/assets/gcal-ics-guide.png.asset.json";
import { cn } from "@/lib/utils";

/**
 * "?" button beside the Google Calendar URL label. Opens a full-screen
 * lightbox showing the illustrated guide for getting a public iCal link.
 */
export function IcsHelpButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  // Esc to close (desktop) + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="How to get your Google Calendar ICS link"
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        onClick={() => setOpen(true)}
      >
        <HelpCircle className="h-3 w-3" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="How to get your Google Calendar ICS link"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 sm:p-8 animate-in fade-in"
          onClick={() => setOpen(false)}
        >
          {/* Close button */}
          <button
            type="button"
            aria-label="Close"
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:right-5 sm:top-5"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>

          {/* Image — stop propagation so clicking the image itself doesn't close */}
          <img
            src={guide.url}
            alt="Step-by-step guide showing how to get your Google Calendar public iCal (ICS) link"
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg bg-white object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
