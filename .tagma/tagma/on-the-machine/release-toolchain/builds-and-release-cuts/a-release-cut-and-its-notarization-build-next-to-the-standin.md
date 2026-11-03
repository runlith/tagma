---
id: 01a16915-34b6-7bf8-9a01-c8c56bc98bc4
title: A release cut and its notarization build next to the standing cut, resume from the last mark, and stand through one link swap
ord: 11
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1411a-c7a8-7e4d-8d8a-93fd24871a8d
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/notarize.ts
  - kind: file
    ref: apps/tagma/server/src/cut/stage.ts
---
A cut takes minutes, notarization takes more minutes of waiting on Apple, and a command life limit, a signal, or a machine failure may cut the command off. So the release directory (`release`, or `--out`) is a link to the standing cut's directory next to it, `<directory>-<version>-<12 commit chars>`, with a `-notarized` suffix on the notarized one. The new becomes standing only by link swap: the new `<directory>.next` link is renamed over the previous one, and that is atomic.

- **A new cut builds in its own directory**, whose identity is the version and the commit. Marks are written to a temp file and renamed into place, so an interruption never leaves a half-written one: `feed.json` before `release.json`, and `release.json` only after every platform's archive and DMG are built and have passed proof; a trial run that ran to the end leaves `tried`. A retry with the same commit and version takes what already lies there: a built cut is never rebuilt, a tried one never retried. A directory with no `release.json` is an interrupted build — it is wiped and built anew. A cut already standing with the same version and commit is an instant answer once its archives — and, when notarized, its recorded disk images — match `release.json`; a mismatch refuses instead of handing out an unproven file.
- **The predecessor stands in place until the link swap**, so a trial run after an interruption finds the same archive; no copies are needed.
- **The reader resolves the link once** and reads the record, archive, DMG and maps from the directory it pointed to: `publish`, `notarize`, `tagma:stack` and `tagma:transition` never mix two cuts' files when the link changed mid-work. The directory they read may be deleted by another cut's link swap; then the read refuses instead of taking someone else's.
- **Only cut directories are deleted:** after the link swap — every directory next to it named `<directory>-…` carrying the `.cut` mark, which the cut places into its own directory first thing, except the new one. A directory with no mark and a similar name is left alone.
- **Notarization builds the notarized cut in its own directory:** the Apple submission id is written right after its answer, and a retry awaits the answer by the written id instead of submitting again; an interruption between Apple's answer and the id write leads to a resubmission. Every platform has its own unpack spot and submission ids for the app and its DMG, and the platforms run as independent chains at once — app, staple, Gatekeeper, archive and DMG around the stapled app, DMG, staple, Gatekeeper on the DMG — so a platform's DMG waits only for its own app. Its archive and DMG land in the cut directory by rename, the DMG last, and the presence of both marks the platform's app as accepted. The standing cut never changes all this time, so its `release.json` always matches its archives. The sealed `release.json` records the sha256 and size of each platform's final stapled DMG (`imageDigests`), taken after its staple and Gatekeeper, and `notarize` and `publish` verify them before they reuse the notarized cut; a notarized cut recorded without them is sealed again in place, never trusted unproven. Maps, inputs, the brand assets and the log move over from the standing cut before the link swap. A cut that carries a `brand` directory makes its disk images from it, so a notarization resumed after HEAD moved never reads the live brand art; a cut without one uses the descriptor's assets.
- **A release directory from previous versions** is a real directory with a cut inside; it serves as predecessor as is and moves to `<directory>.retired` on the first swap. That swap takes two steps, so every cut, notarization and upload that finds no release directory first drives it through: it places `<directory>.next`, and without it returns `<directory>.retired` into place. An already standing `<directory>.retired` next to a real release directory is not ours, and the cut refuses instead of wiping it.

Rejected: keeping the predecessor as a copy in a temp directory and building the new cut over the release directory — an interruption between deletion and the `release.json` write lost both the predecessor and the built.
