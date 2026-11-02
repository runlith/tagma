---
id: 01a13c7f-b7b8-77fb-b506-75271c89545b
title: "Tagma on Mac lives with no terminal: the chosen release runs, a failed transition rolls itself back, the server never depends on the app place, the window speaks in human words"
ord: 14
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a1047e-ddf0-7edd-b8da-e66cc3dad364
  - kind: relates
    to: 01a12699-1673-714b-a6a5-79e89b246531
  - kind: relates
    to: 01a13666-7072-79da-a7f4-bce12fbc8082
sources:
  - kind: file
    ref: apps/tagma/desktop/src/installation.ts
  - kind: file
    ref: apps/tagma/desktop/src/main.ts
  - kind: file
    ref: apps/tagma/desktop/src/release.ts
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/desktop/src/waitingPage.ts
  - kind: file
    ref: apps/tagma/server/src/composition/speech.ts
  - kind: file
    ref: apps/tagma/server/src/installation/closure/leases.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
  - kind: file
    ref: apps/tagma/server/src/mac-applications/placement.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/install.ts
---
A human knows one act about Tagma — opening the app. He installs it from the DMG, drags a new version over the old one, deletes the app and installs it again, moves it, reboots the Mac, presses "Update" and "Go back". After any of these Tagma works whole — window, server, agents, sound, dictation — with the chosen release. What Tagma cannot fix itself it says in human words and gives one act in the window. Terminal, command, path, pid, port and log a human never needs.

The trigger was a tester 0.1.0 call refusal: "the installation declares no desktop audio helper — choose another source or device". The install had deleted the file where the window wrote the app place, and on start the server looked for the sound helper by it and decided for the rest of its life that it was gone; the cleanup is fixed by commit 5353aee96c. Reading the whole lifecycle — with an independent critic, runs on the 0.1.0 archive in a temporary HOME and code reading — showed five cause classes, and sound is not the limit:

1. **The "which release runs" truth lives in three places** — `current`, the live server and the window — and they diverge. A new app connects to the old server; rollback never holds; `current` switches before the new release proves it starts, and after a failed update Tagma never comes up at all, with an exit only through the terminal.
2. **The server takes its parts by a place a human owns** — the sound helper from `Tagma.app`, wherever he put it — and decides it once at start.
3. **Files with no owner**: the app place is written by any open copy, before it knows whether it is the only one; the cleanup deleted "everything but".
4. **Recovery needs a server or a terminal**: rollback, data return, stopping Tagma.
5. **The window speaks internals**: a waiting page with `tagma serve` and log paths, a first screen "Register one from the terminal", refusals with codes and agent hints.

## What a human gets

| What he did | What happens |
|---|---|
| Opened Tagma from the DMG first time — from Applications, Downloads or right off the DMG disk | Tagma installs its release, raises the server, the window opens; calls and dictation work. If not opened from Applications — the window once offers "Move to Applications" |
| Opened again, rebooted the Mac | Nothing installs; the server comes up if not running |
| Dragged a new version over the old one and opened | The new release installs, the running server moves to it with an ordinary restart — agents, terminals and commands survive it; the window opens in the new one; macOS permissions kept |
| Opened a new copy while the old window open | The open window takes the new copy and does the same as the line above |
| Opened an older app | The chosen release opens; its app takes the opened one's place |
| Went back to a past version, then opened a copy of the new one | The window asks: "You went from 0.2.0 back to 0.1.0. Update to 0.2.0 again?" |
| Opened a release app past which there is no way back | Before install the window says so and asks consent, like the "Update" button |
| Moved, renamed or deleted one app copy | Nothing breaks: the server never needs the app place |
| The new release never started | Tagma stays on the old release with old data: "Tagma 0.2.0 never launched, you are on 0.1.0" — "Retry", "Report a problem" |
| Closed the window | Tagma keeps running, agents continue |
| Picked "Quit" (Cmd+Q) | Nothing works — Tagma stops whole. With agents, terminals or a call running — only the window closes, Tagma keeps running |
| Picked "Stop Tagma" in the app or Dock menu | Tagma stops whole; before it the window names what will stop |
| Denied microphone or Accessibility | The window says what never works, and gives "Open Settings" on the right page |
| The address Tagma answers with a foreign program or another Mac account's Tagma | The window never opens it and says so in words |

## Rules

1. **A move to a release is an attempt, and the release itself rolls it back.** Install puts `current` on the new release and before it writes an attempt record `{from, to}`. The `to` release server, having opened the local door, removes the record: the choice happened. A pre-door failure is rolled back by the `to` release with its own code: returns store copies taken on attempt entry, puts `current` on `from` and exits; whoever waited for it raises `from`. If `to` is killed mid-attempt, on next start it sees the record with no door, tries once more, and after a second failure rolls back the same way. Rollback is lossless because before its door the attempt writes only into what copies cover.
2. **Window and server converge to the chosen release themselves, and the window rule is minimal.** Every issued window copy decides forever, so the window has three branches: its release older than `current` — it replaces itself with the chosen release's app; newer than `current` or not installed — installs its release (`install-from` from its app) and asks the server to restart; equal — nothing, and a server not on `current` — asks it to restart. Only a just-opened copy ever installs itself: a window that already ran on the chosen release follows `current` on any divergence — after "Go back" it becomes the old release with no question. Tagma Dev (a build with no release number) follows the server, never asks for a restart and never replaces its app. Whether to ask a human (return from this release, irreversibility, rolling back this release's last attempt — "Tagma 0.2.0 never launched, you are on 0.1.0. Try again?") is decided by the new release's `install-from`; the window shows its question, so a failed release is never retried in a loop.
3. **A release is self-sufficient.** The release directory `~/.tagma/install/<v>` holds the release and a copy of its `Tagma.app`; a window opened from the release v app puts its own copy there when missing. The server takes helpers from its own directory, and checks sound availability on every request. Where a human keeps the app the server never needs: place records and server-driven app moves go away.
4. **Only the owner writes and deletes, and only its own recognized.** Cleanup deletes a directory only when it is a release (`install.json`), nobody holds it and it is party to no open attempt; a release being installed holds a lease from directory creation. A window writes and moves nothing until it became the single instance.
5. **A human sees words and an act.** Window and app never show commands, paths, pids, ports or logs. Every state where Tagma never works has a window act: retry, go back, switch, report a problem. A refusal on a human press says what failed and what to do; code, `unblock` and details — under "Details" and in the "Report a problem" file. `unblock` stays an agents-and-CLI dictionary.
## How built

### Release on the machine — install module [[6cc306ce]]

- **`install-from`** checks the release and its own app signature (`codesign --verify --deep --strict`), clones the release and the app into `install/<v>` (`cp -c`; from the DMG disk — an ordinary copy), lifts quarantine from copies — only after signature verification — checks free room for the copy and snapshot room before copying, writes the attempt record `{from, to}` and puts `current`. The release directory takes a lease at creation (`claimVersion`). A human question (return from this release, irreversibility for `current`) is an answer verb the window asks and repeats the call with consent; the answer shape is agreed with the window implementer.
- **Attempt record** `{from, to}` and **return record** "a human left V" — one file each beside `current`, with the same owner (`installation/closure`). `current` stays a symlink: launcher, entry point and server read it. The return record is written before `current` and holds while `current` equals its target.
- **Restart** always raises `current`, as with every issued server (`restart_server {}`).
- **Store copies.** On first attempt entry, under the data-directory lock and before stores open, the `to` release copies whole files of the machine store (`tagma.sqlite` with `-wal`/`-shm`), `activity.sqlite` and the performance store — APFS clones, and where unavailable an ordinary copy after a room check. Rollback returns these files, so everything `to` wrote before the door disappears, in every table, and no dangling references exist. A table snapshot before migrations stays for manual developer recovery; attempt rollback never uses it — it never holds pre-door tables, and `to` writes into them before the door (dictionary catalogs in the machine graph). Before its door the attempt deletes and rewrites no files outside copies: call-record cleanup, retention and activity-trash wait for their owners' doors; a module's resumed handed work runs after the door; execution host untouched before the door, and the release switches its logic only after the door ([[e0867f81]]). No room for a copy — the attempt refuses before stores open, in words. Only the release that took the copies does recovery, and repeats on every start until it succeeds. Exception — a store the `from` release served and wrote after a failed return (file fingerprints diverged, and the migration ledger at the level equals the copy ledger): the release leaves it as is, moves `current` to `from` and deletes the copies (`kept`); the window reports it as an ordinary rollback. If it refused, the window says "Tagma 0.2.0 never launched and never returned data" and gives "Retry" and "Report a problem".
- **Cleanup** (`pruneVersions`) — by rule 4.

### App — desktop window [[2f69b0c4]] and `mac-applications` [[79a88a92]]

- **Single instance is the first act** after `setName` and `setPath('userData')`. A second instance hands the first its app path (`requestSingleInstanceLock(additionalData)` → `second-instance`) and exits writing nothing; the first applies rule 2 to that copy.
- **Convergence** — the three rule-2 branches on every connect. The window sends a restart request once per divergence and shows the refusal; while installing or restarting it waits and never asks. The window raises the server only when the address is silent and nobody holds the data directory. The window opens a server only when `/health` names its data directory.
- **The window replaces only its own app.** Older than `current`: when the app directory is writable — puts the chosen release's app copy from `install/<current>/desktop` beside it, swaps and reopens; when not (DMG disk, translocation, Applications with no rights) — opens from that copy. "Move to Applications" copies the app from `install/<v>/desktop` to `/Applications` (no rights — `~/Applications`) and opens from there; the original untouched.
- **Update from the window** — as in [[e7b7be7f]]: the server installs the release and restarts on `current`; the window, connected to the new server, replaces itself by the "older" branch. The server never moves apps: the `application` record, `.Tagma.app.next/.prev/.lock`, `bringToStable`, `sendHome`, `windowOf` go away. `mac-applications` stays app-copy, in-place bundle replace and signature check.
- **Tagma Dev** carries no release number: its app, whose release is not installed, installs as now.
- **Quit.** Closing the window leaves Tagma running. "Quit" with no work — agents, terminals, calls — stops the server and its executions with an ordinary exit; with work it closes only the window. "Stop Tagma" in the app and Dock menus names what will stop first — including that Claude Code and Codex will stop seeing Tagma. Exit on a system command (logout, reboot) runs with no questions.

### Sound and input — server composition [[13182a9f]]

- Sound helper — `install/<v>/desktop/Tagma.app/Contents/Helpers/Tagma Audio.app` of its release: the same code as the server's, so the helper protocol never diverges between releases. The macOS permission is expected for the same signature and bundle id as the human's app; for the Developer ID it is unmeasured ([[c3dad364]]).
- `AudioDevices` checks helper availability on every request.
- `permission-denied` the window shows with an "Open Settings" button on the "Privacy → Microphone" page; system sound and Accessibility — the same, once their refusal is measured how to notice.
- Before muting, the helper records the sound state; the next helper at start restores it when the previous one never returned it.

### Words — window, app and refusal owners

Phrases in this spec carry meaning; the window and app language is English, as the whole interface.

- **Window waiting page** (`waitingPage.ts`) — states in words and actions: "Installing Tagma…", "Starting…", "Tagma 0.2.0 never launched, you are on 0.1.0", "Tagma Dev runs now — Switch", "No room: need N GB — Retry", "Report a problem". Paths, commands, addresses and the "Open http://…" button go away.
- **First screen** with no projects offers the system folder dialog.
- **Update chip** — number, size, "Update", "Go back"; no `tagma status`, command echo or "Copy log path".
- **A refusal on a human press** — in its own words: the refusal owner declares them beside the refusal in its operation wire, no central dictionary ([[edea5454]]). This spec translates lifecycle, sound and dictation refusals, first screen and updates; refusals inside agent threads stay as they are.
- **"Report a problem"** works with no server too: the window builds the file ([[0a20e25b]]).
## Moving from 0.1.0

0.1.0 is the first build given past the operator; 0.1.1 (with fixed cleanup) carries the same window. Testers have no app copy in the release directory, and the 0.1.0 server holds a frozen "no helper". The 0.1.x window rewrites the app place on every launch and moves the copy from the new server's release directory to that place — the new window returns the copy by rule 3, so the machine converges in one cycle. With the 0.1.x window open a new app is swallowed by its second-instance handler: a tester is told to close Tagma (Cmd+Q) before opening the new one. The next release brings such a machine to the rules with a double click: a human opens the new app → the window installs its release with an app copy and an attempt record → asks the 0.1.0 server to restart (`restart_server {}` — the same door as its "Update" button; terminals and commands survive it) → the new server comes up on `current`. Leftover 0.1.0 layout (`install/application`, `.Tagma.app.next/.prev/.lock`) is removed by each following release when found. After "Update" in the 0.1.x window Tagma at once runs the new release, and the app in Applications becomes the new one on next open: a 0.1.x window with no place record opens from the copy in the release directory.

From 0.1.0 stay forever: the place-handover protocol between servers ([[9b246531]]) with restart on `current`, and tester data. Accepted by the operator: the baseline migration ([[842e3529]], [[4581b954]]) collapses the chain to exactly what 0.1.0 carried, and everything after is ordinary migrations; otherwise a tester store would be older than the baseline and never open.

## What is measured before implementation

On a clean Mac with a notarized build (the operator's is a MacBook Air M2), results — in [[c3dad364]] or beside:

- copy of `Tagma.app` in `~/.tagma/install/<v>/desktop`: no second "Tagma" appears in "Open with", Dock, Spotlight, no `open -b com.runlith.tagma` hijack; no fresh macOS microphone question when the helper opens from the copy;
- copy from the DMG disk after quarantine lifted: no Gatekeeper dialog when the helper opens;
- Finder when replacing the open app and the behavior of the process from the replaced bundle;
- App Management when replacing `Tagma.app` in Applications by Tagma itself;
- system sound: what capture answers on permission refusal and how to notice it; what a repeated Accessibility request does after refusal.

If an app copy breaks anything of the first two items, the sound helper moves into the release as a separately signed bundle, and rule 3 stays.

## What changes in other nodes

- [[e7b7be7f]]: "App place", "Order" and "Removal" sections replaced by this spec; a new app opening also asks consent to the irreversible, as the "Update" button does; "server outlives the window" — until "Quit" with no work or "Stop Tagma"; rollback and update a human gives with buttons, `tagma release …` commands stay the developer's.
- [[c7d48051]], rule 3: "Quit" with no work also stops the server.
- [[9b246531]]: "Failure" after ownership handover — attempt rollback by rule 1; the old handshake door from "First run" stays forever.
- [[5f9b619e]], "Out of scope": return after a pre-door attempt migration is now in scope.
- [[0a20e25b]]: window-less-server report — in scope.
- [[4581b954]]: baseline migration — by the "Moving from 0.1.0" decision.

## What the implementer proves

- **Moving from 0.1.0** is the main proof. The `~/.tagma-dev/release/tagma-0.1.0-darwin-arm64.tar.gz` archive in a temporary HOME updates to the current build (a) with its own button through a `file:` feed, (b) by opening the new app. After: `/health` names the new release, `current` is the new one, sound `present` with the `--synthetic` helper hello (no TCC), a terminal opened before update alive.
- **Attempt rollback.** Predecessor — 0.1.0 or a past build, successor — current with a failing migration; two outcomes — failure caught and `kill -9` mid-migration. Checked: the earlier build opens the store with no `MigrationChainInvalid`; the predecessor-written row before restart in place; `current` earlier; a window start raises the earlier release. No room for copies refuses before stores open.
- **Window and install decisions** — itests in a temporary HOME over real functions: first launch from a writable and a read-only place; repeat; move, rename, delete the app; two copies and the second instance handing the new copy to the first; old app, including a cleaned release; new app with an old-release server running (`/health` stub); return and then a copy of the new one (question); cleanup beside a foreign directory, a release being installed and an open-attempt party; quarantine lifted only after signature verification. This proves decisions, not the transition: transition is item one.
- **Sound** after N→N+1 and after the human's app deleted: `availability` = `present` with `--synthetic` hello.
- **Release trial run** (`trial.ts`) installs an earlier cut from the release directory, updates to the built one through `install_next` with restart and gets the helper hello.
- **Quit**: "Quit" with no work stops the server; with a running terminal it leaves it.

## What the operator checks

On a second macOS user or second Mac with a notarized build — the "What a human gets" table rows: DMG → call; new version over the old one with the window open → call; reboot; return and a copy of the new one; app deletion; "Quit" with and without a running agent; "Stop Tagma"; microphone refusal → "Open Settings".

## Out of scope

- A local door between accounts of one Mac and a port held by a foreign program: now any process on loopback acts as the Tagma owner, and the channel port is fixed. A separate spec for the door; here — only that the window opens its own Tagma.
- Start at login and launchd supervision ([[2e073431]]).
- Refusals inside agent threads; Intel, Linux, Windows.
