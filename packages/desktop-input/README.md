# @runlith/desktop-input

macOS boundary for holding one key binding from any application and pasting
text into the focused one. Owns the native event tap, the binding match, the
⌘V keystroke and the clipboard swap around it, none of which Electron can do on
its own.

## Shape

- `native/desktop-input` — Swift SPM sidecar (`runlith-desktop-input`). A
  long-lived process with an active `CGEventTap` that matches the bound key
  itself and reports only its hold transitions (and `Esc` while asked), swallows
  a bound chord while asked, and pastes text with the clipboard swapped and
  restored around a ⌘V. Requires the Accessibility TCC grant and follows its
  changes through the system's accessibility notification.
- `src/DesktopInputHost.ts` — Node owner of the sidecar lifecycle: spawns it,
  sends the binding, projects its stdout into typed holds, and reports its loss.
- `src/internal/protocol.ts` — the single Zod parser for the sidecar wire shape.

## Build

```bash
bun run --cwd packages/desktop-input build          # universal native + dist
bun run --cwd packages/desktop-input build:runtime  # single-arch native + dist (local dev)
```

The built `bin/runlith-desktop-input` is not committed; a fresh checkout runs
`swift build` (macOS only).

## Permissions

The event tap and synthetic paste both require **Accessibility** (System
Settings → Privacy & Security → Accessibility). `start()` reports whether the
process is trusted; `promptAccessibility()` surfaces the system prompt.
