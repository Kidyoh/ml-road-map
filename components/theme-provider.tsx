"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * globals.css defines a full dark palette under `.dark`, but nothing applies
 * that class on its own. Without this the app is light-only, which is a poor
 * deal for a product whose main screen is a long-form reading page.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
