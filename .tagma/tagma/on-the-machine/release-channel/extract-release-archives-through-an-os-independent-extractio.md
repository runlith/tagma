---
id: 01a1a821-d156-742e-9fda-5e8d4abc0c7b
title: Extract release archives through an OS-independent extraction contract
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a814-ff9b-7d00-88c6-a374e602bb66",
    "status": "in_work"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/release-channel/archive.ts
---
The shared release-channel runner calls `unpackCommand` from `archive.ts:6-7,27`, which embeds `/usr/bin/tar` and macOS-only `--no-mac-metadata` and `--no-fflags`. Linux arm64 Docker verification with Bun 1.4.4 on 2026-11-04 reached `runner.itest.ts:289` after replacing its macOS platform fixture and failed because GNU tar rejects `--no-mac-metadata`; the terminal installation result records the command, exit 64 and stderr. Move extraction behind an owner-declared contract with composition-bound platform implementations, or reuse one portable extractor preserving the current no-owner, no-xattr, no-ACL and no-file-flags semantics. Keep the channel journey unmarked and prove it on Linux and macOS through `NextInstallation.install`, including failed extraction and cancellation cleanup; an OS suffix would hide a shared-code defect.