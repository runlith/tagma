---
id: 01a1b1c0-98e5-732c-b08b-923bf6325236
title: Tagma Dev opens the published release in a fresh world beside itself and starts it over in one act; the channel switch goes
ord: 103
tags: ["spec"]
fields:
  {
    "status": "closed"
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
    ref: apps/tagma/server/src/installation/setup/stopping.ts
  - kind: file
    ref: apps/tagma/desktop/src/waitingPage.ts
  - kind: file
    ref: apps/tagma/server/src/cut/beside.ts
---
Tagma's developer works in Tagma Dev all day and must see, at any moment and without stopping that work, exactly what a new user gets from the published release — first launch, sign-ins, the first project, updates — and start it over from nothing in one act. The only road was the channel switch ([[2fbc8082]]): it stopped Tagma Dev with every agent and terminal, and the release then opened on the developer's own account, not a new user's.

## What the developer gets

- **Open Fresh Tagma** — an item in Tagma Dev's View menu and `tagma-dev fresh`. The first time, it takes the newest release from the release feed, places the published `Tagma.app` in a world of its own and opens it; while that world runs, the act brings its window forward; standing and closed, it opens it again. Tagma Dev keeps running untouched.
- **Start Fresh Tagma Over** — a menu item and `tagma-dev fresh --over`: the fresh world quits, everything it wrote is removed, and the release opens again on its first launch. No confirmation: the act is the request.
- **Which release** — `--release <version>` takes any release the feed lists (an older one tests the update path through the release's own update offer); `--from <path>` takes a local `.app`, `.dmg` or release archive, a cut not yet published among them. Either starts the world over. Without them, the newest of the feed; a build that knows no feed takes the newest kept release, and an unreachable feed refuses, naming the kept releases. A release taken from the feed is kept in Tagma Dev's data directory (`fresh/releases/<version>`), so a start over clones it instead of downloading: its cost is a quit and a launch.
- **Close** — quitting the fresh window, as a user quits.
- `tagma-dev fresh --status` and `read_fresh_world` answer whether it runs, its release, its root and its address, so a Tagma Dev agent asked to can open the fresh world's surface in the built-in browser and walk a first launch.

## Why it stands beside Tagma Dev

Everything channels share on one account is found from `HOME`: the junction (`active.lock` and the entry point for hooks and MCP), the data directory, the launcher and the shell profile it edits, the harness homes and Electron's `userData`. The fresh world is the release launched with its own home in `~/.tagma-fresh/home`: it has a junction of its own, so `channel-active` never meets it, and the stable ports (5643–5646) are not dev's.

Nothing else in its environment is Tagma's. `open` hands the launched app the caller's whole environment, so the release is opened under one built from nothing — `HOME` and `CFFIXED_USER_HOME` on the fresh home, `TMPDIR` in the fresh root, the user's name and Finder's PATH — the same isolated home the release cut's trial world uses; LaunchServices adds only what any app opened from Finder gets, and the app's relaunches keep it. No beside mode is set: the release integrates its own projects as a user's installation does.

## What a fresh world is and is not

It is a new user of the published release on the developer's Mac: Tagma data and keys of its own (`tokens.json` and `secrets.json` are files of its data directory), no projects, no transfer offer (its home holds no other world), harness CLIs signed out, no git identity, ssh keys or shell profile. The home gets an empty, unlocked login keychain of its own: under another home macOS finds no login keychain at all, so a harness CLI signing in there stores its login in the fresh one and never reaches the developer's.

It is not a new Mac: the machine's tools stay — `/usr/bin/git` with Command Line Tools installed, CLIs on system paths. Gatekeeper's first-open check and the move to Applications are not exercised: the bundle stands unquarantined in the fresh home's `Applications`. `Tagma.app` opened from Finder or the Dock starts on the account's own home, as any app does; the fresh world opens only through the act. A new Mac — a disposable macOS VM — is a separate spec.

## Start over

1. The window gets SIGTERM and the act waits for it to end, so it cannot raise its server again; then the release's own `tagma quit` under the fresh environment ends its server, execution host and terminals; whatever still runs from under the root is ended with SIGKILL, and the act goes on only when no process of the root lives.
2. What macOS keeps for the bundle outside the home is reset: privacy permissions for the app and the helpers whose ids extend its own (Electron's helpers carry the stock id Tagma Dev shares, task [[0870c6d1]]), while LaunchServices still knows them, and the preferences domain, which `cfprefsd` keeps in the real `~/Library` whatever the home says. Caches and the other Cocoa paths follow `CFFIXED_USER_HOME` into the home.
3. The root is removed, then LaunchServices forgets every registration under it, since it keeps a deleted bundle registered.
4. The kept release is cloned into a staging copy in the new home, its signature verified, renamed into place and opened; nothing of the standing world needs to read for a start over, so a broken one is replaced too. A registration LaunchServices keeps refuses the act.

Start over never touches `~/.tagma-dev`, `~/.tagma`, the account's junction, harness homes or shell profile. Waiting is on process exits, never a deadline.

## The channel switch goes

Its one purpose was letting the developer look at the release; a release user has one channel and never meets it. Removed: `tagma switch` and the switch act of the waiting page. The stop mechanics `quit` uses stay, named for quitting. `channel-active` stays: two servers on one home would share one set of harness configs and one entry point, so the second still refuses, and the waiting page names the running channel, says to quit it, and offers Try again — no act of one app stops another app's agents. The switch feature is superseded by the fresh world's ([[7aee640f]]); the transfer offer stays.

## Owners

- The developer module `fresh-world` (marked `"tagma": {"build": "developer"}`), wired only into the developer composition: its operations (`open_fresh_world`, `read_fresh_world`), the `fresh` verb, the catalog entry and the door binding that fills it. The window's menu items stand where the dev surface items do: in a build with no release number. The release carries none of it.
- The feed address is the distribution's `feed`, built into the developer cut as it is into the release; a build cut without one refuses `fresh-no-feed` unless `from` or a kept release serves. The release channel's feed reader, download and archive unpacking are reused.
- The macOS part — disk image, signature, keychain, launch, processes, quit, bundle reset, LaunchServices — is the `FreshHost` port the macOS release platform fills; the module knows no OS. The isolated home and LaunchServices forgetting are shared with the cut's trial world.

## Proof

- Unit, through the service over a host double and a memory filesystem: starting over ends the window before quitting, kills what remains, resets the bundle while the root stands and forgets registrations after it is gone, then opens the kept release; an open on a standing world launches it again or brings it forward; with no feed, no kept release and no `from` the act refuses before stopping anything.
- Live, on the developer's Mac with Tagma Dev running: the first open took 0.2.2 from the feed, unpacked and opened it in 27 s; its server answered on 5643 with its database and junction under `~/.tagma-fresh/home`; Tagma Dev's `active.json`, `~/.zshrc` and `~/.claude/settings.json` stayed byte-identical and it kept answering on 5633; nothing of the bundle appeared in the real `~/Library`. Starting over took 21 s from the kept release: every earlier process ended, a new server and data stood, one registration remained under the root.
- Not run: the window's menu items and the `fresh` verb against a live server, and a harness sign-in inside the fresh world.
