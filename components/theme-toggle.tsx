"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

/**
 * Both icons render and the `dark:` variant picks one. The obvious alternative -
 * reading `resolvedTheme` and rendering a single icon - cannot work on the
 * server, so it needs a mounted flag set in an effect, which is both a lint
 * error and a visible flash. CSS already knows which theme is active.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden size-4 dark:block" aria-hidden />
      <Moon className="size-4 dark:hidden" aria-hidden />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
