import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";

/** Sun and moon morph into each other (rotate and scale; a plain crossfade under reduced motion). */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`} className="relative">
      <Sun aria-hidden="true" className="theme-icon size-[1.1rem]" data-active={theme === "dark"} />
      <Moon aria-hidden="true" className="theme-icon size-[1.1rem]" data-active={theme === "light"} />
    </Button>
  );
}
