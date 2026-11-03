---
id: 01a1a21e-4549-7e66-ad45-d4a4f405abcc
title: A release is one command, and its platforms try and notarize side by side
ord: 21
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/notarize.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/pipeline.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/publish.ts
  - kind: file
    ref: apps/tagma/server/src/composition/cut/commands.ts
---
**Outcome.** Releasing is one command: `tagma:release publish` takes the checkout's HEAD to a published, notarized, verified release, and a repeat takes up where it stopped. `tagma:release` alone ends at a notarized cut — the build a tester can open — since an unnotarized cut opens on no other Mac. The wall time of a release is about half of today's: the two platforms try and notarize side by side.

**Today (0.2.2, one sample on an M-series Mac).** Build of darwin-arm64, then darwin-x64: ~2.5 min each. Trial of each: ~1.7 min each, one after the other. Notarization: app arm64, app x64, then DMG arm64, DMG x64, each waiting for the one before: ~3–4.5 min each, ~14 min in all. Upload: one file after another. A release is three steps someone has to know — cut, notarize, publish — and checking what reached people (the feed, the files, Gatekeeper on the DMG) is done by hand.

**Design.**

- **Platforms side by side where they wait.** The cut tries every target at once: each trial world takes its own data directory and a free port block. The targets still build one after the other: their producers record inputs, source maps and the release log in one place per cut, read, merged and rewritten by each build, so two builds at once could prove one target with the other's inputs; separating them costs per-target maps that `tagma:stack` cannot tell apart, for about 2.5 min of a ~11 min release. Notarization runs one chain per platform at once: app → staple → Gatekeeper → archive and DMG around the stapled app → DMG → staple → Gatekeeper on the DMG. A platform's DMG no longer waits for the other platform's app. Resume stays per platform: submission ids are recorded as Apple answers, a platform whose archive and DMG stand is not redone.
- **The DMG is judged as a person meets it.** After its staple, `spctl --assess --type open --context context:primary-signature` must answer `accepted` with `source=Notarized Developer ID`, as the app already must for `--type execute`.
- **One command.** `tagma:release` = cut + notarize. `tagma:release publish` = the same, then publish, for HEAD: a HEAD a release tag names is answered as that release; a standing cut of HEAD is taken whatever its number, so an interrupted publication completes under its own number; only a HEAD with no cut is cut. `tagma:release notarize` stays for a cut made by an older build. `--notarize` goes: notarizing is no longer optional.
- **Publish verifies what people get.** After the publisher answers and before the tag, the command reads the publisher's feed again and requires this release newest, then asks every archive and DMG at its published address and requires its size. A feed the host still serves from cache is asked again for as long as its cache allows; any other mismatch refuses, naming the address and what it answered.
- **The publisher places files side by side.** A distribution's publisher uploads the release's files concurrently; its order — files, then the record, then the feed — stays.

**Out of scope.** Building on other machines; cutting platforms other than darwin; the developer build (`tagma:build`), which never goes to Apple.

**Acceptance.**

- Trials and notarization chains of the two targets run concurrently.
- A DMG that Gatekeeper would not open refuses the notarization.
- `tagma:release publish` on a clean HEAD with nothing cut ends with the release published and verified; run again, it answers the same release without a new cut, Apple submission or upload.
- A release of this build takes roughly half of today's wall time, measured on the next release.
- notarize and publish itests pass with the new chain and verification.
