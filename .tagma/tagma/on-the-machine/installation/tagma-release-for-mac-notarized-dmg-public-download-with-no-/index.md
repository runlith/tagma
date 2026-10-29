---
id: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
title: "Tagma release for Mac: notarized DMG, public download with no sign-in, update from the window with consent, no sources"
ord: 16
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
A human downloads `Tagma.dmg` — from the Releases page, from a message, from anywhere — drags Tagma to Applications and launches: Gatekeeper stays silent, the window opens, the server runs. Then Tagma itself finds new releases and installs them with his consent, never losing granted permissions. Distribution is public with no sign-in; who Tagma is open to and for what is a separate app question, not a download one. Delivery carries nothing that only a Tagma developer has, no source files and no Tagma comments; the release pipeline proves it.

## What the user gets

- **DMG** for Mac arm64 (macOS 13+): notarized, stapled, opens offline with no warning. The DMG window is familiar: the Tagma icon left, an Applications folder alias (symlink to `/Applications`) right, background with an arrow; the user drags one onto the other. Later — `brew install --cask tagma` from the same DMG.
- **First launch with no terminal and no network**: the app carries the release inside and installs it into `~/.tagma/install` itself. Git needed (Command Line Tools shim shows a dialog); macOS 13+ and free space checked.
- **`tagma` command** — from an "Install `tagma` command" button in the window and `tagma release path`; the shell profile never edited without consent. Without it hooks in repos stay silent.
- **Release notice** in the window status line and in `tagma status`: number, size, whether irreversible changes exist. Update — from a button or `tagma release update`; download progress visible, network refusal named. No silent update.
- **Rollback** to the previous release — button and `tagma release back`, while the next release applied no irreversible change (below). If it did, consent to update says "no way back" upfront.
- **macOS permissions** — microphone, system sound, Accessibility — survive updates: every release signed by one Developer ID and one bundle id.
- **Removal**: the app deleted from Applications as usual, data and releases stay; `tagma release remove` removes releases — a developer command. Update, rollback and consent to the irreversible a human gives with window buttons, including when opening a new app ([[1c89545b]]).

## Why its own update, not Squirrel or Sparkle

The Tagma server outlives the window — until "Quit" when nothing runs, or "Stop Tagma" ([[1c89545b]]): Claude Code and Codex CLI, hooks and agents work with no window, agent executions held by a separate execution host. Replacing the whole `.app` with a restart would tear that work apart and give no rollback. So each release is a separate `~/.tagma/install/<release>` directory with a lease, `current` and ownership handover to the successor (`succession`); the new release installs beside, the server moves to it through `succession` (seam [[5f9b619e]]), the window restarts in the `Tagma.app` of the new release (`app.relaunch`), because the old window's main and preload are incompatible with a new surface ([[d801f443]]). Checkout builds update through the same mechanism.

## Modules

- **Next-install source is the `installation` port** with two adapters ([[6f758080]]): **checkout** (checkout build: `cut`, commit window, `tagma build/update`) and **release channel** (feed, download, verify, install). Machine wire and UI speak generically: "a next install exists, its size and irreversibility, install, roll back"; `build-head`/`update-tree` actions are the checkout adapter's dictionary.
- **Two server compositions**: developer and release. Each lists its module set; the core never knows which build. Everything developer-only is one package or module mark `"tagma": {"build": "developer"}`: the checkout adapter, reflections into the Tagma graph. The release composition never wires them, release checks read the same mark and never name either ([[edea5454]]).
- **Release pipeline** — in `installation/cut` beside the current one: builds the release into a separate root (as `releaseBeside`), signs, notarizes, packs archive and DMG, checks, uploads on the operator's word. It never touches the build machine's `current`.
## Release is a signed `Tagma.app`

- **One delivery unit.** `Tagma.app` carries the release in `Contents/Resources/release` (`install.json`, `bun`, `bin/…`, helpers), signed and notarized whole. The DMG holds this app; the update archive is the same app as `tar.gz`. No second "archive without app" layout. `Tagma Dev` from checkout builds the same way. No `desktop` role in `install.json`: the manifest describes only the release, the app's signature proves integrity, and whose release it is is told by its own `Contents/Resources/release/install.json`.
- **Install** (`install-from`, on first launch and on update) checks the manifest (`verifyInstallation`), clones `Contents/Resources/release` into `~/.tagma/install/<release>` (`cp -c`, APFS costs no room), clones bun into `executions/` — the host bundle is self-sufficient ([[d86d6647]]) — and switches `current`. The server runs from the release directory, not from the app: the app is replaced on update, the directory is not.
- **First launch.** A window finding no `current` whose release is this app calls `install-from` from its own `Contents/Resources/release`, then raises the server. Reopening the same app installs nothing. `install-from` refuses a release older than `current`: down leads only rollback.
- **App place** is where a human put it; the server never needs it. Each release keeps a copy of its app in `install/<release>/desktop/`, and the app in place is replaced by the window itself — mechanism, attempt transition with retry and rollback, three-branch window rule — [[1c89545b]]. App replacement in `/Applications` is allowed by App Management only to the same Team ID signature, so replacement is checked with the Developer ID (step 5). The window holds its release directory lease with a holder process (release `bun` with a shared `flock`); the server holds the lease of the directory it runs from.
- **Trial before implementation** on a second Mac: Spotlight, Dock, login entry, App Management, microphone and Accessibility after two app replacements in `/Applications`; app replacement while open.

## Distribution

- **Public `runlith/tagma` repo** in the `runlith` org, with no code: each release's archive and DMG in Releases, the feed a `feed.json` file in the `main` branch.
- **Feed** — `https://raw.githubusercontent.com/runlith/tagma/main/feed.json`, `release.feed` setting. Moving to its own domain and CDN changes that address; the client never changes.
- **No sign-in.** The archive downloads by `browser_download_url` with no token.
- **Build** — `bun run tagma:release [--version x.y.z]` from a clean tree: reads the published `feed.json`, takes the version — named or next after the newest published (`0.1.4` → `0.1.5`, the first — `0.1.0`) — and builds into one place `<dev data>/release/`, replacing the past build: app, `Tagma-<version>.dmg`, update archive, maps, `release.json` and a feed from that one build for update trials. What is never built and never published a user never gets: builds can run any number of times.
- **Upload** — `bun run tagma:release publish` takes what is built: GitHub Release `v<version>` with archive and DMG through `gh`, then the new `feed.json` commit last, so no client ever sees a release with no archive. Then tag `v<version>` on the checkout build commit and maps into `<dev data>/maps/<version>`. If a version not below was published since the build, upload refuses to GitHub: the build repeats. Upload first checked against a test repo.
- **Feed checked** at server start and once a day; the request anonymized, the feed domain in the published network-call list.

### Channel contract

- **Feed** — JSON `{"releases": [{"release", "archive", "sha256", "size", "irreversible"}, …]}`, newest release first, release object flat. `size` is archive bytes, `irreversible` is the consent declaration: the release is irreversible for the previous one.
- **Release number** is its version: one to three integers through a dot (as `CFBundleVersion`), compared numerically. A feed record also carries store marks (`stores`) and accumulated irreversible changes (`changes`): the next build judges from them whether it is irreversible for the newest published. It is also `identity.build` in `install.json` and the app's `CFBundleVersion`. The release directory is named by timestamp: the directory name is not the number. Only the offered release installs — the newest past the running one; down leads only `tagma release back`.
- **Archive** is an `https:` address; `file:` only from a `file:` feed (tests and the second-Mac check). The archive root is `Tagma.app`. The archive holds only files, directories and symlinks with a relative in-app target: no absolute paths, no `..`, no hard links, no `._*`. The release checks the listing before unpacking, unpacks with no xattrs or ACL, checks the app signature (`codesign --verify --deep --strict`) and that its identity matches the running release's, then the manifest and digests with its own code — before launching the downloaded `bun`.
- **Irreversibility in the release itself** — `install.json` carries `irreversible: [{"store": "machine-store" | "host-store" | "graph" | "journal", "release": "<number>"}]`: everything this and earlier releases changed so an older one cannot read, with the changing release's number. Rollback to previous release P refuses when the running or current release declares a change newer than P; the feed flag is only the declaration in the offer.
- **Update from the window** downloads the archive, checks sha256, checks the listing, unpacks into `~/.tagma/update`, checks the signature and the release and hands it to the new release's `install-from`: the new release installs itself with its own code. Stop breaks download, unpack and check; `install-from` runs to the end, but never past its ceiling.
- **Order** at install: attempt record `{from, to}`, then `current`; an attempt that never reached the door is rolled back by its own release ([[1c89545b]]). On start the server reconciles the `installing`-left record with `current` and writes `landed` when the target is already current.
## Signature and notarization

- **Inside out**: every Mach-O — release `bun`, sound and input helpers, native modules, Electron Framework and Electron helpers — signed with hardened runtime and a secure timestamp, then `Tagma.app`. Nothing signed is changed after signing.
- **Entitlements per executable**: `bun` — `com.apple.security.cs.allow-jit` (without it JIT silently switches off and code runs ~55 times slower, [[c3dad364]]) and whatever the official bun set needs for our code, proven by measurement; Electron — its standard set; microphone — `com.apple.security.device.audio-input` and `NS…UsageDescription` strings in the owning `Info.plist`.
- **Notarization is a publish step, not a build one.** The build signs with the Developer ID (seconds) and runs any number of times; it never waits for Apple. `tagma:release publish` first notarizes the build — `xcrun notarytool submit --wait`, then `xcrun stapler staple` on `Tagma.app` and the DMG and `spctl --assess` — and only then puts it on GitHub. Apple refusal stops publishing before upload and prints the journal (`notarytool log`); an already notarized build is never resubmitted on republish. Tagma Dev is never notarized or Developer ID signed.
- **Developer ID switch** resets every permission once: the Team ID enters the signature requirement.

## Public build

- **Composition.** Developer-marked packages and modules never enter the release. `file_reflection` leaves the release, the friction prompt section (`graph/doctrine/friction.ts`), reflection target search and skills referencing them (`performance`); `#reflection` type stays in the core catalog as graph vocabulary. `bun run tagma:build` hints live only in the checkout adapter.
- **No sources, full minification.** Release JS minified fully — whitespace, syntax and names — in Bun.build CLI of server and workers, Vite surface and desktop esbuild; `keepNames` enabled only for code reading a class or function `name`, and the release trial run checks that such code never broke. No release part carries a sourcemap, source files, Tagma comments or module-path banners. VS Code and Cursor ship so; it makes reading expensive but never promises closed code.
- **Release maps** — outside the archive: the build's in `release/maps`, a published version's in `<dev data>/maps/<version>`. `bun run tagma:stack <version>` prints a stdin stack in source files and lines.
- **Providers.** Only vendor-allowed roads: Claude through `claude` and the Agent SDK; Codex in Codex login and Tagma modes ([[52b10a62]]); API keys and OpenAI-compatible ones.

## Two channels

Tagma and Tagma Dev are two channels with their own worlds on one machine, of which one runs; the mechanism — [[2fbc8082]]. The paragraph below is what the release needs of it.

The release is the `stable` channel: `Tagma`, `com.runlith.tagma`, Developer ID, data directory `~/.tagma`. The developer install is the `dev` channel: `Tagma Dev`, `com.runlith.tagma.dev`, the machine's self-signed identity, `~/.tagma-dev`. Everything the release writes on the machine — `install/`, `current`, launcher, app place — lives in its channel's directory.

## Release number

The version people see ("Tagma 0.1.5"). The build puts it — into the bundle (`define`), `Info.plist` (`CFBundleVersion` and `CFBundleVersionShortString`), the window `package.json`, DMG and archive names — and upload writes it to the feed and tag. It is the release name, not a data shape ([[acb620dd]]): code only compares "newer".

## Irreversible changes and rollback

Release N+1 is irreversible for N when it applied a machine or host store migration, a graph step (committed in `.tagma/format.json`, N's record refuses `vocabulary-newer`) or a journal shape step. The release pipeline records it in the release `install.json` (`irreversible`, with earlier releases' changes) and declares it with the feed flag; rollback reads irreversibility from the running release, reconciles machine-store migrations and runs `prepare_downgrade` before switching `current` (`DowngradeSteps`: commit queue closed and empty); a failed preparation leaves `current` as was and opens the queue. A `vocabulary-newer` refusal in the release offers updating with the same act as the release notice — teammates' releases diverge.

## Migrations before the first release

From the first build given past the operator, migration and step chains are eternal ([[acb620dd]]). Order:

1. Lines with first-run transition doors land — [[d86d6647]], [[9b246531]], [[842e3529]] — and their doors are deleted after the operator's machine walks them.
2. Format numbers go away: `VOCABULARY_FORMAT` (kept in mirrors, code branches on it), `executions/1` and `WIRE_RANGE`, `InstallationManifest.version` — with their own migrations and steps.
3. Collapse into the baseline with transitional translation code: machine store (`scripts/baseline.ts`); execution host (no mechanism — either built or the store recreated, recorded as operator execution-history loss); performance created anew (842e3529). Passed graph steps and journal shapes stay in code between releases; the release never requires collapsing them.
4. The operator updates; translation code deleted.
5. First release.

## What breaks a foreign machine now

- **Hooks** now written with an absolute home path and committed (`.claude/settings.json`, `.codex/hooks.json`). Hook — `command -v tagma >/dev/null 2>&1 || exit 0; exec tagma hook <verb>`: silent with no Tagma, calls it by name with Tagma.
- **PATH.** If launchd gave it the PATH, the server at start takes PATH from `$SHELL -ilc` with a timeout: Dock launches would otherwise never find `claude`, `codex` and Homebrew git. Owner — the server, not the window ([[51c66cb6]]).

## Reproducible release build

- The release refuses when the build machine's `Bun.version` differs from `packageManager` or bun sha256 differs from that version's official binary.
- No Whisper fails the release.
- Build-machine paths never baked in (`-fdebug-prefix-map`, `--remap-path-prefix`), the check searches the build machine's home in the archive.
- The release builds from a tag on the operator's machine; Intel, Linux and Windows out of scope.

## Work order

1. **Cleanup.** The npm loader `packages/release-loader` goes away (sh script, `package.json`, README, formula, trial) with its test, GitHub entry (`release-channel/github.ts`, `release.token`, `release.githubClient`, `tagma release sign-in`, `invitation-required` refusal, token in download), the default feed moves to `runlith/tagma`.
2. **Release build.** Release inside `Tagma.app`, first launch from the app, app place and replacement, "Install `tagma` command" button, full minification, maps and `tagma:stack`, DMG.
3. **Upload.** `tagma:release publish` against a test repo.
4. **Developer ID signature** with hardened runtime and entitlements — with no notarization; bun measurement under hardened runtime.
5. **Second-Mac (M1) check.** DMG → first launch → work → N→N+1 update from the test feed → rollback; permissions after two updates. Quarantine lifted with `xattr -dr com.apple.quarantine` until notarization.
6. **Notarization and staple in `tagma:release publish`**; recheck of the downloaded DMG with quarantine, no `xattr`.
7. **Publishing** — on the operator's word.

## Publishing — only on the operator's word

Work on this spec writes code and proves it locally and on a test repo. Creating `runlith/tagma`, uploading a release, sending the first human release to Apple for notarization and cask — each a separate operator word.

## What changes in other nodes

- [[3de8a8fa]] closed by this spec: Developer ID, notarization and DMG are here, "everything inside `Tagma.app`" and Squirrel/Sparkle replaced with the app-release, release layout and `succession`.
- [[c7d48051]]: one stable identity rule stays; the release installs the app itself.
- [[d801f443]]: desktop-shell update resolved here — with a window restart.

## Out of scope

- Intel, Linux, Windows; Mac App Store.
- Release self-observation and "Report a problem" — its own spec [[0a20e25b]].
- Installing `claude` and `codex` from Tagma ([[ec51f8e4]]); SIWC.
- Archive signature over the app one: HTTPS, sha256 from the feed and `codesign --verify`.

## What the implementer proves

- The release builds from a tag into a separate root, the build machine's `current` never changes; three checks pass, and they fail a release with a developer entry, `*.map` or quarantine xattr.
- The minified release passes the trial run; `tagma:stack` maps a release-thrown stack to source lines.
- Under a second macOS user with no keychain identities: the app from the DMG installs itself on first launch with no network, the server starts, the window opens; reopening installs nothing.
- N→N+1 update from a test `file:` feed and from a test repo: notice with size and irreversibility, consent, the app replaced in place, server and window restart; rollback on a reversible release works, on an irreversible one unavailable with an explanation; an app with a broken signature refuses before launch.
- `tagma:release publish` against a test repo: the feed changes only after archive upload.
- `spctl --assess --type execute` accepts the signed notarized app; `stapler validate` passes on app and DMG.
- Hooks in repos stay silent with no Tagma and work with it from another HOME.
- Migrations collapsed: each store's clean store created by one baseline; the operator store opens. Passed graph steps and journal shapes kept; cut never requires deleting or collapsing them.
- A server launched from the Dock finds `claude` and git from Homebrew.

## What the operator checks

- On a second Mac: download DMG, open with no warnings, work, update, roll back; microphone and Accessibility after two updates.
- When he decides to publish: create `runlith/tagma`, upload the release.
