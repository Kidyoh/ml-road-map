import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ML Roadmap",
    template: "%s · ML Roadmap",
  },
  description:
    "Zero to a deployed machine learning system, through 40 gated nodes across 8 phases.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/*
        suppressHydrationWarning on <body> as well as <html>: browser extensions
        inject attributes here before React loads (ColorZilla adds
        cz-shortcut-listen, Grammarly adds data-gr-*), and React reports the
        resulting mismatch as if it were our bug. It is not patched up either
        way; suppressing it stops a real mismatch from being lost in the noise.
      */}
      <body
        className="bg-background text-foreground flex min-h-full flex-col"
        suppressHydrationWarning
      >
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
