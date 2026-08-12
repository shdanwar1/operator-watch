import { useState } from "react";
import { HelpCircle, X } from "lucide-react";
import guide from "@/assets/gcal-ics-guide.png.asset.json";
import { cn } from "@/lib/utils";

/** Small "?" button that opens the illustrated guide for getting a public iCal link. */
export function IcsHelpButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="How to get your Google Calendar ICS link"
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground",
          className,
        )}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="How to get your Google Calendar ICS link"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative my-6 w-full max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md ring-1 ring-border transition-colors hover:bg-background"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={guide.url}
              alt="Step-by-step guide showing how to get your Google Calendar public iCal (ICS) link"
              className="w-full rounded-xl bg-white shadow-2xl"
            />
          </div>
        </div>
      )}
    </>
  );
}
