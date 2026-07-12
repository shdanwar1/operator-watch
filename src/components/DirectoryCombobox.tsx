import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DirectoryOption = {
  name: string;
  usage_count?: number;
  last_used_at?: string | null;
};

type Props = {
  value: string;
  onChange: (name: string) => void;
  options: DirectoryOption[];
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
};

function rank(query: string, options: DirectoryOption[]): DirectoryOption[] {
  const q = query.trim().toLowerCase();
  const scored = options.map((o) => {
    const name = o.name;
    const lower = name.toLowerCase();
    let score = 0;
    if (q) {
      if (lower === q) score += 10000;
      else if (lower.startsWith(q)) score += 5000;
      else if (lower.includes(q)) score += 1000;
      else {
        // word-start match e.g. "beg" -> "Absolute Beginners Barre"
        const words = lower.split(/\s+/);
        if (words.some((w) => w.startsWith(q))) score += 3000;
        else return { o, score: -1 };
      }
    }
    score += Math.min(o.usage_count ?? 0, 999);
    const t = o.last_used_at ? new Date(o.last_used_at).getTime() : 0;
    if (t) score += Math.min((Date.now() - t) / 1_000_000_000, 1) * -1 + 1; // slight recency bump
    return { o, score };
  });
  return scored
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score || a.o.name.localeCompare(b.o.name))
    .slice(0, 50)
    .map((s) => s.o);
}

export function DirectoryCombobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  emptyLabel = "No matches. Press Enter to add.",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => rank(query, options), [query, options]);
  const canCreate =
    query.trim().length > 0 &&
    !options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase());

  function commit(name: string) {
    onChange(name);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 w-full justify-between font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate && filtered.length === 0) {
                e.preventDefault();
                commit(query.trim());
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              {canCreate ? (
                <button
                  type="button"
                  className="w-full px-2 py-1.5 text-left text-sm"
                  onClick={() => commit(query.trim())}
                >
                  Add “{query.trim()}”
                </button>
              ) : (
                emptyLabel
              )}
            </CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((o) => (
                  <CommandItem
                    key={o.name}
                    value={o.name}
                    onSelect={() => commit(o.name)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === o.name ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="flex-1 truncate">{o.name}</span>
                    {o.usage_count && o.usage_count > 0 ? (
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                        {o.usage_count}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
                {canCreate && (
                  <CommandItem value={`__add_${query}`} onSelect={() => commit(query.trim())}>
                    <span className="text-sm">Add “{query.trim()}”</span>
                  </CommandItem>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
