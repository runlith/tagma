---
id: 01a1a310-baa2-7e00-a60a-dc354bbccb3e
title: The macOS application bundle layout stands behind the Applications adapter instead of the core wire
ord: 97
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a30d-3192-78c8-a90e-14527d736b6e",
    "status": "in_work"
  }
---
`installation/contract/wire/layout.ts` declares the macOS bundle shape — `hostBundle(name)` = `<name>.app`, `hostBinary(name)` = `<name>.app/Contents/MacOS/Electron`, `RELEASE_INSIDE` = `Contents/Resources/release` — and `releaseApplication` in `contract/wire/manifest.ts` builds on it, so the platform-neutral core spells one platform's layout. The variance moves behind the platform adapter; the core keeps only the neutral fact that a release keeps its window application under `desktop/`.

Design:
- The three facts move unchanged into `mac-applications/bundle.ts`: issued windows and servers read them, so their values are frozen. The desktop window, the release toolchain, `composition/cut/restart.ts` and macOS tests import them from there (`cut` gains a relation to `mac-applications`, a package export key opens the file to the desktop).
- The `Applications` port gains `kept(root, name)` — the application a release keeps — and `inside(application)` — the release it carries; `mac-applications/placement.ts` fills both. `releaseApplication` leaves the core.
- `release-channel` (`install.ts`, `runner.ts`) already holds the port and calls it; `composition/speech.ts` calls the adapter directly.
- Two Installation sites have no port today: `check_successor` (`operations/restart.ts`, the release a successor's kept application carries, which `Succession` stores for `install-from --new-host`) and the `desktop` verb (`cli/clients.ts`). The verb takes the port as a loader beside `ServerCli`, as `releaseVerbs` does. The operation needs the port in the server's runtime or in `successionLayer`; both are reshaped by [[dfa17642]], which gives replaceable server ports a core default filler through the build descriptor, so the port is provided through that mechanism once it lands.