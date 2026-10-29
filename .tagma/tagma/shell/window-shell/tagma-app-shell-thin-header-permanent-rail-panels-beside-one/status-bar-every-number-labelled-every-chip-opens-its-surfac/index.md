---
id: 01a10891-853e-7f52-89f5-9e2a63cec91b
title: "Status bar: every number labelled, every chip opens its surface, quota meters of all providers stay"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/AwakeControl.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadButton.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/StandingChip.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/StatusBar.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/UsageMeters.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CheckoutTenant.svelte
---
Every number in the status bar has a label, every chip opens its own surface, and the alarm color appears only when action is needed. The 24 px height does not change.

## What is there now

`lib/app/chrome/StatusBar.svelte`:
- `45550c2 ↑4` (`StandingChip`) — `↑4` means “4 commits ahead of what is running”;
- `↑91 · 4 changes` (`CheckoutTenant`) — `↑91` means “ahead of upstream”. Two arrows stand side by side with no labels, and the branch repeats the header;
- `48 % · 1.8 GiB · >_ 0` (`LoadButton`) — no labels;
- coffee cup (`AwakeControl`);
- six quota meters (`UsageMeters`), with red 97% visible on every screen.

## Left

- **Connection.** The `WireState` dot is always there. A word appears only when the connection is not open: `connecting…`; `offline — any action reconnects`; `paused in background`. The indicator moves here from the header.
- **Build** (`StandingChip`): `build 45550c2` and, when present, `4 commits to update`. Other states — building, restarting, host down and the rest — show in words, as now. Popover unchanged.
- **Checkout** (`CheckoutTenant`): `↑91 to origin · 4 changes`, plus `↓n` when behind. No branch name: it is in the header. Clicking opens Checkout.

## Right

- **Faults** (`FaultsButton`): `2 errors`. Shown only when faults exist.
- **Load** (`LoadButton`): `CPU 48% · mem 1.8 GiB · 0 commands`. Hidden by the `appearance.loadInStatusBar` setting, as now: `LoadPanel` still opens from the thread's load badge.
- **Quotas** — the `UsageMeters` row for every provider stays as it was: icon, percentage, tooltip, warning and alarm tone, click opens `UsagePopover`. Operator decision 2026-10-04: any of the user's providers may matter to them, so none hides behind a shared chip.
- **Wakefulness.** The While working / Always / Off choice moves into the app menu ([[54780672]]) as the `Keep awake` item and writes the same `power.keepAwake` setting. The status bar keeps only the warning when holding failed (`unprotected`).

## Chip rules

- Every chip is a button or a link to its own surface. Global goes left, contextual right.
- Color is state only: warning or alarm. No decorative color.
- Labels use interface words; the `text-meta` mono font is for numbers and hashes only.

## How it is built

- Changes in existing components. `StandingChip.svelte` is above the 650-line limit, so changes there must shrink it, not grow it.
- `UsageMeters` and its test stay unchanged except for what the token rule requires.

## Acceptance

- No number in the status bar stands without a label. No branch in the status bar.
- Quota meters of all providers are visible in the status bar, as before this work.
- `Keep awake` from the menu changes `power.keepAwake`, and the status bar shows `unprotected` when holding failed.
- Existing status-bar tests are updated to the new look and pass.
