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
import type { DmcOption } from "@/domain/dmc-directory";

/**
 * Selection-only picker over the canonical DMC directory.
 *
 * Unlike the old free-text combobox, nothing new can be invented here: a record
 * either references a real DMC class / instructor or it references nothing.
 * `fallbackLabel` shows the historical text of a record that predates the DMC
 * references so the operator can see what it used to say while re-selecting.
 */
export function DmcPicker({
  value,
  onChange,
  options,
  placeholder = "Select…",
  fallbackLabel,
  className,
}: {
  value: string | null | undefined;
  onChange: (option: DmcOption | null) => void;
  options: DmcOption[];
  placeholder?: string;
  fallbackLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 100);
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 100);
  }, [options, query]);

  const label = selected?.name || fallbackLabel || "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{label || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No matching DMC entry.</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {selected && (
                  <CommandItem
                    value="__clear"
                    onSelect={() => {
                      onChange(null);
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <span className="text-sm text-muted-foreground">Clear selection</span>
                  </CommandItem>
                )}
                {filtered.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={o.id}
                    onSelect={() => {
                      onChange(o);
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selected?.id === o.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="flex-1 truncate">{o.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
