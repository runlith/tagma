# Tagma

Tagma keeps a project's knowledge as one graph — specs, decisions, rules and the tasks of the work being done — sourced to the code it is about, and runs the agents that read and write it: its own agent on the model provider you choose, and Claude Code, Codex and other coding CLIs as threads of the same workspace.

This repository holds the local product: the server and CLI (`apps/tagma/server`), the app (`apps/tagma/app`), the desktop shell (`apps/tagma/desktop`), the inspection runner (`apps/tagma/inspection`) and the packages under `packages/` they are built from.

## Install the Mac app

1. Download `Tagma-<version>-arm64.dmg` (Apple silicon) or `Tagma-<version>-x64.dmg` (Intel) from the [latest release](https://github.com/runlith/tagma/releases/latest). macOS 13 or newer.
2. Open the DMG, drag Tagma into Applications, replacing an older Tagma there, and open it. The first launch installs the release it carries into `~/.tagma/install` and starts the server; it needs no terminal and no separate runtime.
3. `tagma release path` puts the `tagma` command on your PATH.

Tagma looks for updates when its server starts and once a day, reading the `feed.json` of the latest release at `https://github.com/runlith/tagma/releases/latest/download/feed.json` (setting `release.feed`). A newer release shows in the status bar and in `tagma status` with its download size and whether there is a way back from it. It installs from the window or with `tagma release update`; nothing updates on its own. A release that fails before it starts serving restores the previous release and its data by itself. `tagma release back` returns to the release kept before the current one, unless the current one changed data that release cannot read.

## Run from source

1. Install [Bun](https://bun.sh) 1.4.4 or newer:
   ```sh
   curl -fsSL https://bun.sh/install | bash
   ```
2. Clone and install dependencies:
   ```sh
   git clone https://github.com/runlith/tagma.git
   cd tagma && bun install
   ```
3. Put `tagma` on your PATH by linking the server package's bin:
   ```sh
   cd apps/tagma/server && bun link
   ```
4. Start the server:
   ```sh
   tagma serve
   ```
   It listens on port 5633 (`TAGMA_PORT` overrides) and builds the app on start. `tagma status` checks it from anywhere.
5. Register a repository and wire its agents, from that repository's root:
   ```sh
   tagma project add .
   tagma install
   ```
   The graph is kept outside the checkout by default (`stealth`); `tagma project storage <name> team` moves it into the repository under `.tagma/`, where it is committed with the code.
6. Open the app at `http://localhost:5633`.

To update: `git pull && bun install`, restart `tagma serve`, then run `tagma upgrade` to refresh the installed skills, law and hooks.

## Develop

- Types: `bun run tagma:typecheck`.
- Tests: `bun run test` and `bun run test:integration` in a package, or `bun run test:all` for every workspace. `*.test.ts` files are unit tests; tests that need processes, SQLite, sockets or the disk are `*.itest.ts`.
- Native parts build with Rust (`packages/execution-host`, `packages/watch`) and, on macOS, Swift (`packages/audio-darwin`).

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[Apache License 2.0](LICENSE).
