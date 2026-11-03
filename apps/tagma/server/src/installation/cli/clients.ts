import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Console, Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Command, Flag } from 'effect/cli';
import { installationRootIn } from '../paths.js';
import { CURRENT } from '../../platform/contract/wire/versions.js';
import { releaseApplication } from '../contract/wire/manifest.js';
import { InstalledChannel } from '../contract/service/channel.js';
import { refuse, noting, CurrentInvocation } from '../../platform/cli/verb.js';
import { ensureServer, entryRoot, opened, opening, optional, saidServer } from './server.js';
import type { ServerCli } from './port.js';

export const web = (cli: ServerCli) =>
  Command.make('web', { open: opening }, ({ open }) =>
    Effect.gen(function* () {
      const standing = yield* ensureServer(cli);
      yield* saidServer(standing);
      if (!open) return;
      yield* opened([standing.url], standing.url);
    }),
  ).pipe(
    Command.withDescription("open the operator surface in this machine's default browser"),
    noting(`One of two clients of one standing server. Whatever answers at the address is
ADOPTED, whichever build it is; with nothing answering, a server is started from
this same program, detached, and waited for — bounded, and refusing with the
log when the patience runs out. Which browser opens is the operating system's.
The address is printed either way, so \`--no-open\` is how a machine with nobody
at a screen ensures the server and reads where it stands.`),
  );

const application = Effect.fnUntraced(function* () {
  const { readInstallation, refusalDetail } = yield* Effect.promise(() => import('../closure/read.js'));
  const read = (root: string) => Effect.result(readInstallation(root)).pipe(Effect.provide(BunFileSystem.layer));
  const channel = yield* InstalledChannel;
  const status = `${channel.command} status`;
  const broken = (detail: string): never =>
    refuse('installation-refused', detail, [
      `${status} — the next installations this machine’s source offers, the step back among them; installing one replaces what moved`,
    ]);
  const at = yield* CurrentInvocation;
  const here = entryRoot(at);
  const installed = yield* read(here);
  if (installed._tag === 'Failure' && installed.failure._tag !== 'InstallationMissing') {
    return broken(refusalDetail(installed.failure));
  }
  const root = installed._tag === 'Success' ? here : join(yield* Effect.fromResult(installationRootIn(channel, at.env)), CURRENT);
  const standing = installed._tag === 'Success' ? installed : yield* read(root);
  if (standing._tag === 'Failure') {
    if (standing.failure._tag !== 'InstallationMissing') return broken(refusalDetail(standing.failure));
    return refuse('no-installation', `${refusalDetail(standing.failure)}, and a window is a part of one`, [
      `${status} — the next installations this machine’s source offers; once one stands, this verb opens its window`,
    ]);
  }
  const bundle = releaseApplication(root, channel.name);
  if (!existsSync(bundle)) {
    return refuse('no-application-bundle', `the release at ${root} keeps no application at ${bundle}`, [
      `${status} — the next installations this machine’s source offers; installing one again puts its window back`,
    ]);
  }
  return bundle;
});

export const desktop = (cli: ServerCli) =>
  Command.make(
    'desktop',
    {
      open: opening,
      surface: Flag.String('surface').pipe(
        Flag.optional,
        Flag.withMetavar('url'),
        Flag.withDescription("load this address instead of the frozen surface — Vite's, during app work"),
      ),
    },
    ({ open, surface }) =>
      Effect.gen(function* () {
        const bundle = yield* application();
        const aimed = optional(surface);
        const standing = yield* ensureServer(cli);
        yield* saidServer(standing);
        yield* Console.log(`${bundle}${aimed ? ` on ${aimed}` : ''}`);
        if (!open) return;
        yield* opened(['-n', bundle, ...(aimed ? ['--args', `--tagma-surface-url=${aimed}`] : [])], bundle);
      }),
  ).pipe(
    Command.withDescription('open the desktop window of the installation that stands'),
    noting(`One of two clients of one standing server: it ensures a server the way
\`tagma web\` does, then opens the application kept in the installation's \`desktop/\` — of the
closure this program runs from, or of the one that stands on this machine when it runs from a
checkout. What opens is the INSTALLED host,
so a broken working tree cannot break it; without \`--surface\` it shows the
surface at the server's own port. The same application opens from Finder and
needs no server: with nothing answering it stands on a page that says so and
loads the surface the moment the port is there.

ONE WINDOW PER APPLICATION. The host holds a single-instance lock, so a second
\`tagma desktop\` of the same installation reveals the window that stands instead
of opening another — and \`--surface\` then reaches nothing, because the address
rides the arguments of an instance that starts. Aim a standing window by
closing it first, or open the window from the working tree, which is a second
application and stands beside the frozen one.

TWO LADDERS, TWO VARIABLES. \`TAGMA_SERVER_URL\` and \`TAGMA_PORT\` name where THIS
command talks; \`TAGMA_SURFACE_URL\` and \`TAGMA_PORT\` name where the WINDOW loads
from. They are the same address unless a shell sets the first, and a window
that climbs to a different one starts a server of its own beside the one this
verb ensured. \`--surface\` is how a window is aimed on purpose.`),
  );
