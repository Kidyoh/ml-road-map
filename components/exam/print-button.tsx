"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The browser's own print dialog is the PDF export. */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      <Printer aria-hidden />
      Print or save as PDF
    </Button>
  );
}
