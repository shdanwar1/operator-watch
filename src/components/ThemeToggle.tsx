import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/use-theme";

export function ThemeToggle({
  variant = "outline",
  size = "sm",
  className,
  showLabel = false,
}: {
  variant?: "outline" | "ghost" | "secondary";
  size?: "sm" | "icon";
  className?: string;
  showLabel?: boolean;
}) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={className}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {showLabel && (
        <span className="ml-1.5 text-xs">{isDark ? "Light" : "Dark"}</span>
      )}
    </Button>
  );
}
