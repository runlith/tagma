---
id: 01a17f29-c340-781d-b849-69493bb9e31f
title: "\"Updates from genuine runlith/tagma releases: the feed is the latest release's file, one stable channel, no 0.1.x compatibility\""
ord: 40
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a13283-fc95-76c8-a601-3f5eac2d9a04
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/feed.ts
  - kind: file
    ref: apps/tagma/server/src/cut/publish.ts
  - kind: file
    ref: apps/tagma/server/src/cut/published.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/places.ts
---
Tagma updates from genuine `runlith/tagma` releases: 0.2.0 installs from DMG over the issued 0.1.0 and translates its data forward, while 0.2.1 and later reach the running Tagma as a notification and install with its button or `tagma release update`. The channel is one — stable.

## The feed is a release file

- **Where.** `feed.json` lies as a file in every GitHub Release. The app reads `https://github.com/runlith/tagma/releases/latest/download/feed.json`: GitHub serves the file of the release marked Latest — the last published non-draft and non-prerelease. The redirect answers `no-cache`, so the release shows right after publishing, with no `raw.githubusercontent.com` cache delay. The feed commit into `main` and the raw address go away.
- **What.** The feed is the full release list, newest first: a new release carries the previous Latest's feed with itself as the first entry. An entry is `release`, `platforms` (`darwin-arm64`, `darwin-x64` → `{archive, sha256, size}`), `irreversible`, `stores`, `changes`. Entries have no flat fields.
- **One address owner.** The wire `installation/contract/wire/feed.ts` builds the feed address and the release file address (`https://github.com/<repo>/releases/download/v<n>/<name>`): the client reads the address publishing wrote. Archive addresses are written into the feed before publishing: in a draft the files sit under `untagged-…`, after publishing — under the tag.
- **Pulling a release** is marking it prerelease or deleting. Latest moves to the previous release, and its feed never offers the pulled one. Whoever already stands on the pulled one sees "newest is the previous" with no offer; the next release takes the number after the pulled one.
- **No feed** — not one published release, or a closed repository: the address answers 404, the channel calls it `source-unreadable` and offers nothing; the previously read feed stays in `update.json`.
- **One channel.** There are no beta or nightly channels. The `release.feed` key stays: the trial launch and a second machine feed it a `file:` feed. The release channel answers `watched: true`: it reads the feed at startup and once a day ([[55bfcccf]]).

## Publishing (`bun run tagma:release publish`)

1. **Before Apple and before any GitHub write** — reads only: `gh` is installed and signed in, the account has `push` in the repository; the cut's commit is in the repository; the number sits above every published release (prereleases too) and every `v<n>` checkout tag; the release with that tag, when it stands, is a draft or a published one with the same files.
2. **Notarization** — as before: a retry never submits to Apple again.
3. **Draft → files → publishing.** The `v<n>` draft is created with `--target <the cut's commit>`; a standing draft's target is corrected; archives, DMG and `feed.json` upload with `--clobber`; then `--draft=false --latest`. The GitHub tag appears at publishing on the cut's commit, so it matches the tag the upload places in the checkout.
4. **Verification.** The release is published, no prerelease, every file matched by name, size and digest, and every archive address equals the one written in the feed.
5. **The checkout tag and the maps** come last; a retry drives them through.

A retry after failure: the draft is driven to completion, its feed recomputed from the current Latest; a published release with the same files receives local steps only; a published one with different files refuses: bytes under a number are never swapped. A retry never brings back a pulled release: the refusal names the return command. A number the checkout already published but GitHub does not remember (the release is deleted) refuses: it may stand on someone's machine.

## Building (`bun run tagma:release`)

- **The published is read through `gh`**: the Latest feed and the numbers of all published releases. There is no `main` clone.
- **The number** is the named one (`--version`) or the next after the largest of published releases and checkout `v<n>` tags. Without them the first release is `0.2.0`: `0.1.0` was issued outside the feed.
- **Store chains are eternal.** The cut refuses when it lacks a migration or step the newest published release carried: without them its database translates no further. The requirement to fold the previous release's carried `machine-store` migrations is lifted: on 0.2.1 it would require folding 80 migrations of 0.2.0, while a database left on 0.1.0 would get `BaselineNotReached`. Irreversibility is still judged by the newest published release's `stores`. The check reads only the Latest feed: a migration carried by one pulled release is never seen.
- **The trial transition** runs from the standing cut on the build machine's target; the rest of the targets — by fresh install.

## 0.1.x compatibility is removed

Flat feed and `release.json` fields, parsing the previous-format `release.json`, the arm64-archive requirement "for issued clients", the trial-launch branch for a server without `readFrom`, the 0.1.x app-place record (`install/application`, `clearPlace`), the window's restore of the app copy in the release directory, the frozen 0.1.x window in `tagma:transition`. After this 0.1.0 says the feed is unreadable — accepted. The build never reads a 0.1.0 cut in the old format: its directory is moved aside before the 0.2.0 cut.

The tester installs 0.2.0 once from DMG: quit Tagma, drag Tagma from the DMG into "Applications" replacing the old one, and open. The old 0.1.0 app never opens after that, so its window never carries the new release's copy over.

## 0.1.0 data translates forward

The migrations and steps 0.1.0 carried (69 `machine-store`, 19 `host-store`, 20 graph steps, 17 journal steps) are in the code and untouched. Proof is an itest: the machine database and the execution host database with a 0.1.0 ledger open with the current chains, reach the head and keep their rows; the 0.1.0 list is the test's data from its `release.json`.

## Acceptance

- Server and window types; upload, cut and trial-launch tests, the channel test, the 0.1.0 data-translation test and the tests touched by the removal are green.
- Publishing in the test with a `gh` double: a draft targeting the commit, files and feed before publishing, the feed as the previous Latest plus the release, a retry after an upload failure, a pulled release and a deleted number refuse, the number after a pulled one.
- The upload, archive-picking, window, trial-launch and `tagma:transition` explanations describe the new arrangement; the README describes DMG installation and updating.
