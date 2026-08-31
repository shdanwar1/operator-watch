import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import guide from "@/assets/gcal-ics-guide.png.asset.json";
import { cn } from "@/lib/utils";

/**
 * "?" button beside the Google Calendar URL label. Opens a small popover
 * showing the illustrated guide for getting a public iCal link.
 */
export function IcsHelpButton({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="How to get your Google Calendar ICS link"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <HelpCircle className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(92vw,640px)] rounded-xl p-2"
      >
        <img
          src={guide.url}
          alt="Step-by-step guide showing how to get your Google Calendar public iCal (ICS) link"
          className="w-full rounded-lg bg-white"
        />
      </PopoverContent>
    </Popover>
  );
}
