---
id: 01a16e1c-5aa1-7fe2-82b5-9cff5294065f
title: A test process on macOS calls git by the developer-directory real binary, not the `/usr/bin/git` shim
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/core/run.ts
---
`/usr/bin/git` on macOS is an xcrun trampoline: each start finds the developer directory and re-executes the real git. Measured 2026-10-24 (M2 Max, one sample): 22.5 ms CPU for `rev-parse` through the shim vs 10 ms direct; tests start tens of thousands of git processes, so the shim is over half their CPU.

So `confine` puts the chosen developer directory's `usr/bin` (`DEVELOPER_DIR`, the xcode-select link, else Xcode.app, else CommandLineTools — as xcrun itself picks) into PATH right before `/usr/bin`, and only when `git` would otherwise resolve into `/usr/bin`. A directory standing earlier (Homebrew) still wins, and names that resolved into the shim get the same binary the shim would have executed.

A `git` symlink in its own directory is no good: git is built with RUNTIME_PREFIX and derives exec-path and templates from the path it was started by — through the link it finds no `libexec/git-core` and `share/git-core/templates`, and `git init` creates `.git` with no template.
