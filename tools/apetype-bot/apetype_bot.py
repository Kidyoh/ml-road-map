#!/usr/bin/env python3
"""
apetype_bot.py - a fun auto-typer for https://apetype.eyu.et/

How it works
------------
apetype renders the snippet as one <span class="code-char" data-charindex="N">
per character. A line break shows as a span with class "newline-glyph" (the
"↵" symbol), and you type it with Enter. Typed characters get a "correct" or
"incorrect" class.

The bot opens a real browser. Before each line it asks the page where the first
untyped character is, then types up to the end of that line. Asking again on
every line means it never gets out of step with the page, whether auto-indent
is on (the editor fills in the indentation) or off (the bot types the spaces).

Usage
-----
    pip install playwright
    playwright install chromium
    python apetype_bot.py                 # 150 WPM, opens a visible browser
    python apetype_bot.py --wpm 250       # faster
    python apetype_bot.py --wpm 120 --accuracy 0.97   # human-looking
    python apetype_bot.py --rounds 3      # play 3 tests back to back

Once the browser is open, pick your mode, duration and language there, then
press Enter in the terminal to start. Your login is kept in ./.apetype-profile,
so you only have to sign in once.
"""

from __future__ import annotations

import argparse
import random
import string
import sys
import time

from playwright.sync_api import Page, sync_playwright

URL = "https://apetype.eyu.et/"

# Returns the text from the first untyped character to the end of its line,
# with "\n" standing for the ↵ glyph. Returns null when nothing is left.
JS_NEXT_CHUNK = r"""
() => {
  const chars = document.querySelectorAll('.code-char');
  let start = -1;
  for (let i = 0; i < chars.length; i++) {
    const cl = chars[i].classList;
    if (!cl.contains('correct') && !cl.contains('incorrect')) { start = i; break; }
  }
  if (start < 0) return null;
  let out = '';
  for (let j = start; j < chars.length; j++) {
    const c = chars[j];
    if (c.classList.contains('newline-glyph')) { out += '\n'; break; }
    out += c.textContent;
  }
  return out;
}
"""

JS_FOCUS = r"""
() => {
  const el = document.querySelector('input[type="text"]');
  if (el) el.focus();
  return !!el;
}
"""


def key_delay(wpm: float, jitter: float) -> float:
    """Seconds between keystrokes at the given WPM (1 word = 5 chars)."""
    base = 60.0 / (wpm * 5.0)
    if jitter <= 0:
        return base
    return max(0.0, random.gauss(base, base * jitter))


def press(page: Page, ch: str) -> None:
    if ch == "\n":
        page.keyboard.press("Enter")
    elif ch == "\t":
        page.keyboard.press("Tab")
    else:
        # insert_text-style typing handles symbols like { } < > " reliably
        page.keyboard.type(ch)


def type_round(page: Page, args: argparse.Namespace) -> int:
    """Type until the test runs out of text or time. Returns chars typed."""
    page.evaluate(JS_FOCUS)
    typed = 0
    idle_since: float | None = None
    deadline = time.time() + args.max_seconds

    while time.time() < deadline:
        chunk = page.evaluate(JS_NEXT_CHUNK)
        if not chunk:
            # Either the test is over or more text is loading. Wait a bit.
            if idle_since is None:
                idle_since = time.time()
            elif time.time() - idle_since > 2.0:
                break
            time.sleep(0.1)
            continue
        idle_since = None

        for ch in chunk:
            # Optional deliberate typo, fixed right away, to look human.
            if args.accuracy < 1.0 and ch not in "\n\t " and random.random() > args.accuracy:
                press(page, random.choice(string.ascii_lowercase))
                time.sleep(key_delay(args.wpm, args.jitter))
                page.keyboard.press("Backspace")
                time.sleep(key_delay(args.wpm, args.jitter))
            press(page, ch)
            typed += 1
            time.sleep(key_delay(args.wpm, args.jitter))
            if time.time() >= deadline:
                break
    return typed


def main() -> int:
    ap = argparse.ArgumentParser(description="Auto-typer for apetype.eyu.et")
    ap.add_argument("--wpm", type=float, default=150, help="target speed (default 150)")
    ap.add_argument("--jitter", type=float, default=0.25,
                    help="random spread of key timing, 0 = metronome (default 0.25)")
    ap.add_argument("--accuracy", type=float, default=1.0,
                    help="chance each key is right first time, e.g. 0.97 (default 1.0)")
    ap.add_argument("--rounds", type=int, default=1, help="how many tests to run (default 1)")
    ap.add_argument("--max-seconds", type=float, default=300,
                    help="stop a round after this long no matter what (default 300)")
    ap.add_argument("--profile", default=".apetype-profile",
                    help="browser profile folder, keeps you logged in")
    ap.add_argument("--headless", action="store_true", help="no visible window")
    ap.add_argument("--no-wait", action="store_true",
                    help="start right away instead of waiting for Enter")
    args = ap.parse_args()

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            args.profile, headless=args.headless, viewport={"width": 1400, "height": 900}
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(URL, wait_until="networkidle")
        page.wait_for_selector(".code-char")

        for r in range(1, args.rounds + 1):
            if not args.no_wait:
                input(f"\n[round {r}/{args.rounds}] Set up the test in the browser, "
                      "then press Enter here to start... ")
            else:
                page.wait_for_selector(".code-char")
                time.sleep(1.0)
            print(f"typing at ~{args.wpm:.0f} WPM ...")
            t0 = time.time()
            n = type_round(page, args)
            dt = time.time() - t0
            print(f"done: {n} chars in {dt:.1f}s (~{n / 5 / (dt / 60):.0f} WPM raw)")

            if r < args.rounds:
                time.sleep(2.0)
                # The results screen has a "Next Test" button; fall back to reloading.
                try:
                    page.get_by_role("button", name="Next Test").click(timeout=3000)
                    page.wait_for_selector(".code-char", timeout=5000)
                except Exception:
                    page.goto(URL, wait_until="networkidle")
                    page.wait_for_selector(".code-char")
                time.sleep(1.0)

        if not args.headless and not args.no_wait:
            input("\nAll done. Press Enter to close the browser... ")
        ctx.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
