import { Duration, Effect, type FileSystem } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { PreparationNetwork } from '../../contract/wire/preparedTree.js';
import type { GuestLimits, SandboxImage } from '../../contract/wire/sandbox.js';
import { labelFlags, type GuestMarks } from './container.js';
import { dockerSaid } from './image.js';
import { GUEST_HOME, GUEST_PROXY, GUEST_TMP, GUEST_USER, PROXY_PORT } from './layout.js';
import { GuestUnavailable } from './wire.js';

export type GrantNames = {
  readonly network: string | null;
  readonly proxy: string | null;
};

export type Grant = {
  readonly network: string;
  readonly environment: Readonly<Record<string, string>>;
};

const PROXY_LIMITS: GuestLimits = { pids: 128, memory: '256m', cpus: '1' };

const LISTENING_DEADLINE = 50;
const LISTENING_PAUSE = Duration.millis(200);

export const openGrant = Effect.fn('preparation.openGrant')(function* (
  policy: PreparationNetwork,
  names: GrantNames,
  marks: GuestMarks,
  image: SandboxImage,
) {
  if (policy.kind === 'none' || names.network === null || names.proxy === null) {
    const offline: Record<string, string> = {};
    return { network: 'none', environment: offline } satisfies Grant;
  }
  const network = names.network;
  const proxy = names.proxy;
  const made = yield* dockerSaid(['network', 'create', '--internal', ...labelFlags(marks), network], 'create the preparation network');
  if (made.code !== 0) {
    return yield* new GuestUnavailable({
      container: network,
      reason: `the preparation network could not be created: ${made.output.trim()}`,
    });
  }
  const started = yield* dockerSaid(
    [
      'run',
      '--detach',
      '--name',
      proxy,
      '--network',
      network,
      '--user',
      GUEST_USER,
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--init',
      '--pids-limit',
      String(PROXY_LIMITS.pids),
      '--memory',
      PROXY_LIMITS.memory,
      '--cpus',
      PROXY_LIMITS.cpus,
      '--tmpfs',
      `${GUEST_TMP}:rw,nosuid,nodev,uid=65534,gid=65534,mode=1777`,
      '--tmpfs',
      `${GUEST_HOME}:rw,nosuid,nodev,uid=65534,gid=65534,mode=0700`,
      ...labelFlags({ ...marks, kind: 'proxy' }),
      image.digest === '' ? image.reference : image.digest,
      'bun',
      GUEST_PROXY,
      JSON.stringify({ port: PROXY_PORT, hosts: policy.hosts }),
    ],
    'start the preparation proxy',
  );
  if (started.code !== 0) {
    return yield* new GuestUnavailable({
      container: proxy,
      reason: `the preparation proxy would not start: ${started.output.trim()}`,
    });
  }
  const attached = yield* dockerSaid(['network', 'connect', 'bridge', proxy], 'give the preparation proxy its way out');
  if (attached.code !== 0) {
    return yield* new GuestUnavailable({
      container: proxy,
      reason: `the preparation proxy could not reach the network: ${attached.output.trim()}`,
    });
  }
  yield* listening(proxy);
  const address = `http://${proxy}:${PROXY_PORT}`;
  const environment: Record<string, string> = { HTTPS_PROXY: address, https_proxy: address };
  return { network, environment } satisfies Grant;
});

export const closeGrant = Effect.fn('preparation.closeGrant')(function* (names: GrantNames, attached: string | null) {
  if (names.proxy !== null) {
    const gone = yield* dockerSaid(['rm', '--force', '--volumes', names.proxy], 'remove the preparation proxy');
    if (gone.code !== 0 && !absent(gone.output)) {
      return yield* new GuestUnavailable({
        container: names.proxy,
        reason: `the preparation proxy could not be removed: ${gone.output.trim()}`,
      });
    }
  }
  if (names.network !== null && attached !== null) {
    const detached = yield* dockerSaid(
      ['network', 'disconnect', '--force', names.network, attached],
      'detach the builder from its network',
    );
    if (detached.code !== 0 && !absent(detached.output) && !/is not connected/i.test(detached.output)) {
      return yield* new GuestUnavailable({
        container: attached,
        reason: `the builder could not be detached from its network: ${detached.output.trim()}`,
      });
    }
  }
  if (names.network !== null) {
    const dropped = yield* dockerSaid(['network', 'rm', names.network], 'remove the preparation network');
    if (dropped.code !== 0 && !absent(dropped.output)) {
      return yield* new GuestUnavailable({
        container: names.network,
        reason: `the preparation network could not be removed: ${dropped.output.trim()}`,
      });
    }
  }
});

const listening = Effect.fn('sandbox.listening')(function* (proxy: string) {
  for (let attempt = 0; attempt < LISTENING_DEADLINE; attempt += 1) {
    const said = yield* dockerSaid(['logs', proxy], 'read the preparation proxy');
    if (said.output.includes('listening ')) return;
    if (said.output.includes('could not listen')) {
      return yield* new GuestUnavailable({
        container: proxy,
        reason: `the preparation proxy refused to listen: ${said.output.trim()}`,
      });
    }
    yield* Effect.sleep(LISTENING_PAUSE);
  }
  return yield* new GuestUnavailable({
    container: proxy,
    reason: 'the preparation proxy never said it was listening',
  });
});

const absent = (said: string): boolean => /no such (container|network|object)|not found/i.test(said);
