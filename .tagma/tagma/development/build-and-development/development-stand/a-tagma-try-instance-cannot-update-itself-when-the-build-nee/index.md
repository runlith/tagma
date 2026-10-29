---
id: 01a17d0b-0b3e-7b85-af47-64971ac32af8
title: "\"A tagma:try instance cannot update itself when the build needs Rust: substituted HOME hides the rustup toolchain\""
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "The build falls after 46 s: \"the watch engine did not build: rustup could not choose a version of cargo… no default is configured\" — the instance world has HOME=<root>/home, and RUSTUP_HOME and CARGO_HOME are not passed.",
    "command": "bun run tagma:try --root <tmp> --port 47811, then <root>/bin/tagma-dev update --head",
    "expected": "The try instance's server builds HEAD of its checkout and restarts onto it, like the operator's install."
  }
---
Filed from project `tagma`.

`installation/cut/try.ts` sets `world.HOME = besideHome(root)` and spawns the server with this world; the `install_next` build inherits it, and `cargo` via rustup looks for `~/.rustup` under the substituted HOME. The first cut by `tagma:try` itself passes because it runs in the caller's environment. Verifying an update between builds inside a try instance with no manual `RUSTUP_HOME`/`CARGO_HOME` passing is impossible. Log: `<root>/data/build.log`, `<root>/install/release.log`.
