---
id: 01a13a9f-bfdd-7ca9-a819-a45ec11b2c76
title: "\"The server stands in its data directory: the process working directory never depends on who launched it or from where\""
ord: 38
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/server.ts
---
At startup `composition/server.ts` makes its data directory the process working directory — the database directory, for Tagma Dev `~/.tagma-dev` — before launching the first child process. The server holds that directory under lock for its whole life, so it exists while the process lives.

The launch directory does not fit: the launcher picks it, and it is mortal. Desktop passes `install/current`, and the OS resolves it into the version directory; `web` passes the terminal's directory; the successor on restart inherits the predecessor's directory. `pruneVersions` deletes the version directory after two installs, worktrees are deleted by hand. A process in a deleted directory loses everything depending on it:

- `process.cwd()` throws `ENOENT … uv_cwd`.
- `git` without `-C` (`--git-dir`, `hash-object`) fails with "Unable to read current working directory"; in app that is a `graph-pool` refusal.

Child processes — SQLite readers, worker processes, login shells — inherit the server's directory, so the switch happens before them.
