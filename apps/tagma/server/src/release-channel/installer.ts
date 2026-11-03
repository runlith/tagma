import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { CLI_ENTRY, RUNTIME_PART, SERVE_FLAGS } from '../installation/contract/wire/layout.js';
import type { ReleaseArchive } from '../installation/contract/wire/feed.js';
import type { InstallationManifest } from '../installation/contract/wire/manifest.js';
import { placementSchema } from '../installation/contract/wire/placement.js';
import { answered } from '../platform/command.js';
import { undelivered } from './delivery.js';

const decodePlacement = Schema.decodeUnknownEffect(Schema.fromJsonString(placementSchema));

export const installFrom = Effect.fn('ReleaseChannel.installFrom')(function* (
  carried: string,
  release: ReleaseArchive,
  manifest: InstallationManifest,
  env: NodeJS.ProcessEnv,
  log: string,
) {
  if (manifest.identity.build !== release.release) {
    return yield* undelivered(`the offer names release ${release.release}, and the proven manifest names ${manifest.identity.build}`);
  }
  if (manifest.platform.os !== release.platform.os || manifest.platform.arch !== release.platform.arch) {
    return yield* undelivered(
      `the offer is for ${release.platform.os}-${release.platform.arch}, and the proven manifest is for ${manifest.platform.os}-${manifest.platform.arch}`,
    );
  }
  const changes = manifest.irreversible ?? [];
  const declared = new Set(changes.map((change) => `${change.store}:${change.release}`));
  const expected = new Set(release.changes.map((change) => `${change.store}:${change.release}`));
  if (
    release.irreversible !== changes.some((change) => change.release === release.release) ||
    declared.size !== expected.size ||
    [...declared].some((change) => !expected.has(change))
  ) {
    return yield* undelivered(`the irreversible changes in the proven manifest of ${release.release} differ from the offer`);
  }
  const command = [join(carried, RUNTIME_PART), ...SERVE_FLAGS, join(carried, CLI_ENTRY), 'install-from', '--json', '--agreed', carried];
  appendFileSync(log, `\n--- install-from: ${command.join(' ')} ---\n`);
  const ran = yield* answered(command[0]!, command.slice(1), { env });
  appendFileSync(log, `${ran.out}${ran.err}`);
  if (ran.status === null) return yield* undelivered(`install-from could not start: ${ran.text.trim()}`);
  if (ran.status !== 0) return yield* undelivered(`install-from ended with code ${ran.status}`);
  return yield* decodePlacement(ran.out.trim()).pipe(
    Effect.mapError((failure) => undelivered(`install-from answered outside its placement result: ${failure.message}`)),
  );
});
