---
id: 01a1b1c0-98e5-732c-b08b-923bf6325236
title: Tagma Dev opens the published release in a fresh world beside itself and starts it over in one act; the channel switch goes
ord: 103
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a13666-7072-79da-a7f4-bce12fbc8082
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4e7b385f80
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee546656e4ff
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/setup/switch.ts
  - kind: file
    ref: apps/tagma/desktop/src/waitingPage.ts
  - kind: file
    ref: apps/tagma/server/src/cut/beside.ts
---
Tagma's developer works in Tagma Dev all day and must see, at any moment and without stopping that work, exactly what a new user gets from the published release — first launch, sign-ins, the first project, updates — and start it over from nothing in one act. Today the only road is the channel switch ([[2fbc8082]]): it stops Tagma Dev with every agent and terminal, and the release then opens on the developer's own account, not a new user's.

## What the developer gets

- **Open fresh Tagma** — an item in Tagma Dev's app menu and `tagma-dev fresh`. The first time, it takes the newest release from the release feed, places the published `Tagma.app` in a world of its own and opens it; while that world runs, the act brings its window forward. Tagma Dev keeps running untouched.
- **Start over** — a menu item and `tagma-dev fresh --over`: the fresh world quits as a user's Quit does, everything it wrote is removed, and the release opens again on its first launch. No confirmation: the act is the request.
- **Which release** — `--release <version>` takes any release the feed lists (an older one tests the update path through the release's own update offer); `--from <dmg>` takes a cut not yet published. Without either, the newest. A taken release is kept in Tagma Dev's data directory, so a start over clones the kept bundle instead of downloading it: its cost is a quit and a launch.
- **Close** — quitting the fresh window, as a user quits.
- `tagma-dev fresh --status` and the read operation answer whether it runs, its release, its root and its address, so a Tagma Dev agent asked to can open the fresh world's surface in the built-in browser and walk a first launch.

## Why it stands beside Tagma Dev

Everything channels share on one account is found from `HOME`: the junction (`JUNCTION`, holding `active.lock` and the entry point for hooks and MCP), the data directory, the launcher and the shell profile it edits, the harness homes (`~/.claude`, `~/.codex`, …) and Electron's `userData`. The fresh world is the release launched with `HOME` = `<root>/home`: it has a junction of its own, so `channel-active` never meets it, and the stable ports (5643–5646) are not dev's.

Nothing else in its environment is Tagma's. It starts through LaunchServices with the account's GUI environment plus that `HOME` (`open -n <bundle> --env HOME=…`), never inheriting Tagma Dev's variables, PATH or session tokens, and it sets no beside mode: it integrates its own projects as a user's installation does. Its relaunches after an update or a move keep that environment.

The root is `~/.tagma-fresh`, outside both channels' places (`besideConflict` judges it); `home/` inside it holds the fresh `.tagma`, `tagma` and `Applications/Tagma.app`.

## What a fresh world is and is not

It is a new user of the published release on the developer's Mac: Tagma data and keys of its own (`tokens.json` and `secrets.json` are files of its data directory), no projects, no transfer offer (its home holds no other world), harness CLIs signed out, no git identity, ssh keys or shell profile.

The home gets an empty login keychain of its own under `home/Library/Keychains`: on macOS a CLI under another `HOME` reaches its keychain there — the Muse runner links that directory for this reason — so a harness signing in inside the fresh world stores its login there and never reaches the developer's. The performer measures this first; if macOS resolves the keychain otherwise, this section is rewritten before the work goes on.

It is not a new Mac. The machine's tools stay: `/usr/bin/git` with Command Line Tools installed, CLIs on system paths. What macOS keeps by bundle id outside `HOME` — privacy permissions (TCC), the preferences domain, saved window state, caches — belongs to the fresh world, since on the developer's Mac the release runs only there. Gatekeeper's first-open check and the "Move to Applications" offer are not exercised: the bundle stands unquarantined in the fresh home's `Applications`. `Tagma.app` opened from Finder or the Dock starts on the account's own `HOME`, as any app does; the fresh world opens only through the act. A new Mac — a disposable macOS VM — is a separate spec.

## Start over

1. Quit through the release's own `tagma quit` under the fresh `HOME`, which ends its server, execution host and terminals, and wait on that fact. A process that does not end is ended by the pid its data directory's lock names; the act goes on only when no process of the root lives.
2. Remove the root.
3. Reset what macOS keeps for the bundle: `tccutil reset All com.runlith.tagma`, the preferences domain and the rest of the list the performer measured (below).
4. Clone the kept release into the new home and open it.

Start over never touches `~/.tagma-dev`, `~/.tagma`, the account's junction, harness homes or shell profile. A kill of any process mid-act leaves the next start over working.

## The channel switch goes

Its one purpose was letting the developer look at the release. A release user has one channel and never meets it, and the fresh world now serves the developer. Removed: `tagma switch`, the switch act of the waiting page and `switchFrom` as a switch; the stop mechanics `quit` reuses stay. `channel-active` stays: two servers on one `HOME` would share one set of harness configs and one entry point, so the second still refuses, and the waiting page names the running channel and says it must be quit first — no act of one app stops another app's agents. The switch feature [[7b385f80]] is deleted and the waiting-page feature [[6656e4ff]] corrected in the same work; the transfer offer stays as it is.

## Owners

- A developer module `fresh-world` marked `"tagma": {"build": "developer"}`, wired only into the developer composition as `checkout-builds` is: its operations (open with `release`, `from`, `over`; read), its CLI verb, and the window's menu items, which the desktop shows when its server answers the operation, as it does for `start_dev_surface`. The release carries none of it, and the release check names it among the missing by its mark.
- Choosing a release reads the feed through the release channel's reader and the `release.feed` setting; with no feed address the act refuses, naming the setting and `--from`.
- The macOS part — taking the app out of a DMG, verifying its signature (`verifiedBundle`), launching with a `HOME`, the keychain, the bundle reset — is an adapter in the macOS release platform behind the module's port; the module knows no OS.
- `besideHome` and `besideConflict` are reused, not copied.

## Proof

- With Tagma Dev running agents and terminals, open fresh: the window shows the release's first launch; Tagma Dev's `active.json`, `~/.claude/settings.json`, `~/.zshrc`, `~/.tagma` and `~/.tagma-dev` are byte-identical before and after, and its agents keep running.
- Start over: no process of the root lives, the root and the measured bundle list are gone, and the next open is a first launch again. The list is measured once, by diffing `~/Library` before a fresh world's first run and after a session with a sign-in, a project and a permission prompt.
- A harness sign-in inside the fresh world does not see the developer's login, survives a restart of the fresh window and is gone after start over.
- `--release <older>` opens that version; the release offers the newest and updates in place, changing only the bundle and installs inside the root.
- `--from <dmg>` opens an unpublished cut.
- No `tagma switch` remains; a second channel on one `HOME` still refuses `channel-active`; Quit and Stop work as before.
- The release metafile carries no `fresh-world` code.
