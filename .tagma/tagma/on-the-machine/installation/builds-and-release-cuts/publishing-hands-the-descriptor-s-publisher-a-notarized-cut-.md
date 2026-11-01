---
id: 01a1361b-0306-7539-b5f1-3cd46c675b20
title: Publishing hands the descriptor's publisher a notarized cut and its next feed after every read-only check, and tags the checkout only once the publisher placed it
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/publish.ts
---
`tagma:release publish` reads `release.json` and the files it names from the standing cut, and refuses `no-publisher` for a distribution whose descriptor names none; notarizing needs no publisher.

- **Before Apple and before the publisher writes — reads only:** every archive matches the record's size and sha256; the cut's commit is a commit of the checkout; a `v<version>` tag in the checkout names that commit. Unless the publisher's `latest` feed already lists this number, the number sits above every number in that feed and every `v<n>` tag of the checkout, and a number tagged in the checkout that the publisher no longer lists refuses: it may stand on someone's machine. A refusal costs neither an Apple submission nor a write at the publisher.
- **Notarization stays in the cut**, in the notarized cut's own directory, which takes the standing one's place ([[6bc98bc4]]), so a retry never submits the build to Apple again.
- **The feed is computed here:** the publisher's latest feed with this release first and every older release after it, each archive named by the publisher's `address(release, file)`, so the feed names the files before they are placed. The notes are read from the checkout's history since the tag of the highest release below this one.
- **The publisher places it.** `publish` receives the notarized directory, the names of its archives and disk images, the feed and the notes. It places them so that no reader of the feed sees the release before its files, and it takes up what stands when called again with the same publication: publishing is retried after any failure, including one after the files landed and before the checkout tag.
- **Only after the publisher answers** is the cut's commit tagged in the checkout and are the source maps kept, so a tag always names a placed release.
