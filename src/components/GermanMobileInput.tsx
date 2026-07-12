import { forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  id?: string;
  value: string; // 11 digits, no prefix
  onChange: (digits: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
};

/**
 * German mobile number input. Locks the +49 prefix and only accepts the
 * 11-digit subscriber number. Value stored in parent state is digits-only;
 * combine with `+49` when submitting to the server.
 */
export const GermanMobileInput = forwardRef<HTMLInputElement, Props>(
  function GermanMobileInput(
    { id, value, onChange, required, disabled, className, autoFocus },
    ref,
  ) {
    return (
      <div
        className={cn(
          "flex items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0",
          disabled && "opacity-60",
          className,
        )}
      >
        <div className="flex select-none items-center gap-1.5 border-r border-input bg-muted px-3 text-sm text-muted-foreground">
          <span aria-hidden className="text-base leading-none">
            🇩🇪
          </span>
          <span className="font-medium tabular-nums">+49</span>
        </div>
        <Input
          ref={ref}
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="1512 3456789"
          maxLength={11}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D+/g, "").slice(0, 11);
            onChange(digits);
          }}
          className="h-10 flex-1 rounded-none border-0 bg-transparent tabular-nums shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
    );
  },
);
