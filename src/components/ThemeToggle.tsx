import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/use-theme";

/**
 * Icon state is driven by CSS (`.dark` on <html>), not by React state, so the
 * server and client render identical markup and hydration never mismatches.
 */
export function ThemeToggle({
  variant = "ghost",
  size = "icon",
  className,
  showLabel = false,
}: {
  variant?: "outline" | "ghost" | "secondary";
  size?: "sm" | "icon";
  className?: string;
  showLabel?: boolean;
}) {
  const { toggle } = useTheme();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={toggle}
      aria-label="Toggle colour theme"
      title="Toggle colour theme"
      className={className}
    >
      <Moon className="h-4 w-4 dark:hidden" />
      <Sun className="hidden h-4 w-4 dark:block" />
      {showLabel && (
        <span className="ml-1.5 text-xs">
          <span className="dark:hidden">Dark</span>
          <span className="hidden dark:inline">Light</span>
        </span>
      )}
    </Button>
  );
}
