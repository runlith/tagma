# Tagma

Tagma keeps a project's knowledge as one graph — specs, decisions, rules and the tasks of the work being done — sourced to the code it is about, and runs the agents that read and write it: its own agent on the model provider you choose, and Claude Code, Codex and other coding CLIs as threads of the same workspace.

This repository holds the local product: the server and CLI (`apps/tagma/server`), the app (`apps/tagma/app`), the desktop shell (`apps/tagma/desktop`), the inspection runner (`apps/tagma/inspection`) and the packages under `packages/` they are built from.

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
