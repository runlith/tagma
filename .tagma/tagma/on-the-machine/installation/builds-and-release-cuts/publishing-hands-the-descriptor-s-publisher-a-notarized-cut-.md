---
id: 01a1361b-0306-7539-b5f1-3cd46c675b20
title: Publishing hands the descriptor's publisher a notarized cut and its next feed after every read-only check, and tags the checkout only once the publisher placed it
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/publish.ts
---
`tagma:release publish` releases the checkout's HEAD whole: unless a `v<n>` tag already names HEAD, it first cuts and notarizes as `tagma:release` does — a standing cut of the same commit and number is reused, so a repeat cuts nothing — and then publishes what stands. A HEAD a tag names goes straight to publishing, which answers that release again rather than cutting a new number for the same commit. It reads `release.json` and the files it names from the standing cut, and refuses `no-publisher` for a distribution whose descriptor names none; notarizing needs no publisher.

- **Before Apple and before the publisher writes — reads only:** every archive matches the record's size and sha256; the cut's commit is a commit of the checkout; a `v<version>` tag in the checkout names that commit. Unless the publisher's `latest` feed names this number as its newest release — a repeat of the publication — the number sits above every number in that feed and every `v<n>` tag of the checkout, and a number tagged in the checkout that the publisher does not offer as its newest refuses: it may stand on someone's machine, and republishing an older release would drop every newer one from the next feed. A refusal costs neither an Apple submission nor a write at the publisher.
- **Notarization stays in the cut**, in the notarized cut's own directory, which takes the standing one's place ([[6bc98bc4]]), so a retry never submits the build to Apple again.
- **The feed is computed here:** the publisher's latest feed with this release first and every older release after it, each archive named by the publisher's `address(release, file)`, so the feed names the files before they are placed. A repeat whose notarized archives differ from the ones the feed already offers under this number refuses before the publisher is called: bytes under a published number are never swapped. The notes are read from the checkout's history since the tag of the highest release below this one.
- **The publisher places it.** `publish` receives the notarized directory, the names of its archives and disk images, the feed and the notes. It places them so that no reader of the feed sees the release before its files, and it takes up what stands when called again with the same publication: publishing is retried after any failure, including one after the files landed and before the checkout tag.
- **What people get is verified before the tag:** the publisher's `latest` must name this release as its newest — asked again every 10 s for two minutes, the time a host may serve a cached feed — and `served(release, file)` must answer each archive's and disk image's size at its published address. Anything else refuses, so a release that does not reach people never gets its tag.
- **Only after the publisher answers and the check passes** is the cut's commit tagged in the checkout and are the source maps kept, so a tag always names a placed release.
