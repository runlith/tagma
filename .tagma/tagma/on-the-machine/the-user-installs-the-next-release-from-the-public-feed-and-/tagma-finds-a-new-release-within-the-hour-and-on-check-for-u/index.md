---
id: 01a1a208-7040-7fd9-8a20-10a393ab0ba3
title: Tagma finds a new release within the hour and on Check for Updates…
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/release-channel/runner.ts
  - kind: file
    ref: apps/tagma/desktop/src/quitting.ts
---
**Outcome.** A running Tagma learns of a published release within an hour, and the person can ask for it at any moment: **Check for Updates…** in the Tagma menu, the ↻ of the status popover, `tagma release check`. Today the server reads the feed at start and then every 24 hours, and nothing asks it sooner: a person who keeps Tagma open learns of a release up to a day late, and only a server restart shows it earlier.

**How other apps do it.** VS Code checks shortly after start and then every hour, and has Check for Updates… in its menu. Mac apps on Sparkle carry the same item right under About and check on a schedule. A found update shows where the app already shows its state, with an action that installs and restarts.

**Design.**

- **One check, at its owner.** The release channel already has the act that reads the feed and publishes the new frame. `NextInstallation.check` runs it and answers the frame it produced. The schedule runs the same act at start and then every hour instead of every 24. A check is one GET of a few-kilobyte file the release host caches for 60 s: no cost on any machine, and 24 reads a day per installation are nothing for the host.
- **Operation `check_for_updates`** (operator, HTTP, never asks): runs the check and answers the next frame. An unreadable or unreachable feed answers the frame carrying its issue, exactly as a scheduled read does; there is no new refusal.
- **CLI:** `tagma release check` prints the standing line — "Release 0.2.2 is out · this is 0.2.1" or "Running release 0.2.2, the newest" — and the issue when the feed could not be read.
- **App:** `Standing.check()` performs the operation, takes its frame and then reads the machine. The ↻ at the foot of the status popover calls it, so it re-reads the feed as well as the machine.
- **Desktop:** **Check for Updates…** stands in the Tagma menu right after About Tagma, as in every Mac app. Choosing it reveals the window and asks the app, over a new bridge member, to open the status popover and check. The popover stays the one place that shows the offer, its install button, progress and whether there is a step back: the menu adds no second update interface. A newer app served into an older shell finds no member and simply has no menu item.
- The `release.feed` setting's description names the hourly reading.

**Out of scope.** Installing without the person's action; system notifications; changing what releases already shipped do — they keep their daily reading until they update.

**Acceptance.**

- The channel reads the feed at start and every hour.
- After the feed changes, `check` answers a frame offering the new release (release channel itest).
- `check_for_updates`, `tagma release check`, the popover's ↻ and the menu item all run that one check.
- The menu item stands in the Tagma menu right after About; choosing it opens the status popover with a fresh reading.
- Server, app and desktop typecheck.
