---
id: 01a13c9b-6e47-7eb9-82e5-4f3e5e37dc34
title: "Release on the machine: install-from with app copy and signature check, attempt transition with rollback by its own release, cleanup of its own only, server moves no apps and takes the helper from its own directory"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c9d-2ae0-7b6d-97ab-853784c4ca99",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13c7f-b7b8-77fb-b506-75271c89545b
---
Server half of [[1c89545b]]: rules 1, 3 and 4, "Release on the machine", "Sound and input" (except muting), leftover 0.1.0 layout cleanup.

- `install-from` (`release-channel/install.ts`): `codesign --verify --deep --strict` of its own app → copy of release and app into `install/<v>` (`install/<v>/desktop/<channel name>.app`) → quarantine lifted from copies only after verification → space check for copy and snapshot before copying → attempt record `{from, to}` → `current`. The release directory takes a lease at creation (`claimVersion`). A human question (return from this release, irreversibility for `current`) — an answer verb the window asks and repeats the call with consent; answer shape agreed with the window implementer.
- Attempt record and return record — `installation/closure` files beside `current`. The `to` server, having opened the local door (`door-ready local`), removes the attempt; only an installed server in its own install root does this. Failure before the door — rollback with its own code: stores to the snapshot before migrations, `current` to `from`, exit. An attempt without a door at the next start — one retry, then rollback. List everything the attempt writes before the door besides the machine store (execution-host store, a module's resumed work) and cover with a snapshot or move past the door. No room for a snapshot — refusal before migrations.
- Cleanup: only release directories with `install.json`, without a lease and not party to an open attempt.
- Server moves no apps: from the `Applications` port and `mac-applications/placement.ts` go `application`, `.Tagma.app.next/.prev/.lock`, `place`, `kept`, `windowOf`, `borne`, `bringToStable`, `sendHome` and their calls in runner, `release remove`, `installation/cli/clients.ts`. Functions still imported by `apps/tagma/desktop` are deleted by the window implementer once it stops calling them. Each following release removes 0.1.0 layout leftovers (`install/application`, `.Tagma.app.next/.prev/.lock`) when found.
- `composition/speech.ts`: sound helper — from `install/<v>/desktop/…/Tagma Audio.app` of its own install (a checkout server — of the install the channel hands); `AudioDevices` checks availability on every request. `DarwinChannel` takes the host app on each `open`.

Done: itest decisions of install in a temporary HOME (copy, quarantine only after signature, space, installing lease, cleanup beside a foreign directory and an attempt party); attempt rollback on its own instance — predecessor a past build or 0.1.0, successor with a failing migration, outcomes "failure caught" and `kill -9`: earlier build opens the store, predecessor row in place, `current` earlier; server finds the helper at any app place and after its deletion.

Review fixes — 390bbadcef (server) and 4675f5bf02 (window): rollback returns whole store copies, `install-from` runs under the install lock, pre-door cleanup waits for its owners at their doors ([[9e8adf53]]). Not proven:
- rollback on copies never ran live with a 0.1.1 archive: the earlier manual run was on a table snapshot, and no `*.stest.ts` builds from it — it needs closure built from the tree (minutes) and an archive from `~/.tagma-dev`;
- refusal for missing room for the app copy or store copies unchecked by test: needs a full disk or a seam that does not exist;
- `attempt-open` window branch untested: `install-from` in the window test runs from inside a synthetic `.app`;
- execution-host store before the door — task [[e0867f81]].

Live rollback on copies, 2026-10-15: predecessor — 0.1.1 archive from `~/.tagma-dev/release`, successor — closure built from HEAD slice fcb05550ef (plus ba4345cbfd and 1dd1a683eb) in a temporary worktree; temporary HOME, ports 5743–5746, transition through `restart_server {}`. Under 0.1.1 a counter execution ran the whole time. Scripts — in the `install` thread's scratch (`proof/`).
- **Failure caught.** A failing migration already refused on the copy trial: `ended.data: restored`, `current` on 0.1.1, predecessor raised its build, 22 migrations, predecessor row in place.
- **`kill -9` mid-migration.** Two `to` starts killed in the second migration, once the first had already landed in the store. The third start rolled the attempt back ("started 2 times and never opened its door", `restored`), the next start raised 0.1.1 on 22 migrations.
- **`to` writes before the door outside migrations.** An altered `core` catalog text was planted into the `to` copy plus a failure after `runtime composed`. While `to` stood before the door it rewrote `block`, `event`, `meta` and `search_*` rows of the global project. After rollback each `tagma.sqlite` table content hash matched the pre-attempt one. The run found a defect: a failure of the server module itself outside `phase` before the door caused no rollback, because cli and server are separate bundles with their own `composition/attempt.ts` copies. Fixed in 1dd1a683eb, the case passes after the fix.
- **`unrestored`.** The main store copy was made unreadable before the failure: `ended.data: unrestored`, `current` stayed on `to`. While 0.1.1 held the directory, the `to` start exited waiting for a free directory. After stopping 0.1.1 and returning rights, the `to` start returned the files (`restored`, `current` on 0.1.1).
- **Host and execution.** In all cases the 0.1.1 holder and host-logic pids kept, logic unchanged. Counter output reads continuously through 0.1.1 with no gaps from `n0`.

The 0.1.1 path that raises its build when `to` died before the door is closed in a489dbe305.
- After `kill -9` behavior left as is: 0.1.1 refuses on a partly migrated store and exits. The attempt is finished by the next `current` start. The window now makes that start itself, and on the surface too: asks `/health` every 2 s.
- After `unrestored` the store files' fingerprint is written with the outcome. If another release has since written the store, a repeated copy return does not install but writes `kept`.
- Live run, slice 98cf30db98: `unrestored` → 0.1.1 raised its build and wrote a `setting` row → 0.1.1 stopped → `to` start gave `kept`, `current` back on 0.1.1, copies gone. Then 0.1.1 came up, and the row was in place.
- `data/mirror` mirrors never changed (inode, size, mtime) while `to` stood before the door.
