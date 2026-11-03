import { Effect } from 'effect';
import type { Unblock } from '../../platform/contract/wire/refusal.js';
import type { InstallRefused, RestartRefused, StopRefused } from '../contract/service/next.js';

export const occupied = (what: string, since: string): InstallRefused => ({
  code: 'install-running',
  reason: `${what} since ${since}, and this call did not name it as the one to stop`,
  unblock: [
    "install_next again: it names the installation that runs now, and stops it first with the operator's word",
    'tagma status — where it stands',
  ],
});

export const restarting = (what: string, unblock: Unblock): InstallRefused & StopRefused => ({
  code: 'install-restarting',
  reason: `${what} landed and the restart onto it is already asked`,
  unblock,
});

export const askedRestart = Effect.fn('NextInstallation.restart')(function* (
  restart: Effect.Effect<void, RestartRefused>,
  say: (line: string) => Effect.Effect<void>,
) {
  yield* say(`=== then restart, asked by pid ${process.pid} ===`);
  const refused: string | null = yield* restart.pipe(
    Effect.as(null),
    Effect.catchTag('RestartRefused', (failure) => Effect.succeed(failure.message)),
    Effect.catchDefect((defect) => Effect.succeed(`the restart could not be asked: ${String(defect)}`)),
  );
  yield* say(refused === null ? '=== restart asked: the successor stands by ===' : `=== restart refused: ${refused} ===`);
  return refused;
});
