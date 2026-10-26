import { KeyUnavailable, SafeStorageKey } from '@runlith/browser-cookies/source';
import { Context, Effect, Exit, Layer, Scope, Stream } from 'effect';
import { Hosts } from '../browser/contract/service/hosts.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { type Attachment, makeAttachment } from './attachment.js';
import { DesktopChannel } from './contract/service/channel.js';
import type { Order } from './contract/wire/channel.js';

type Held = { readonly attachment: Attachment; readonly scope: Scope.Closeable; claimed: boolean };

export const makeDesktopChannel = Effect.gen(function* () {
  const hosts = yield* Hosts;
  const scope = yield* Effect.scope;
  const attachments = new Map<string, Held>();
  let generations = 0;

  const end = Effect.fnUntraced(function* (held: Held, reason: string) {
    if (attachments.get(held.attachment.host.id) === held) attachments.delete(held.attachment.host.id);
    if (held.attachment.done()) return;
    yield* Effect.logInfo(`desktop browser: host ${held.attachment.host.id} generation ${held.attachment.generation} ends: ${reason}`);
    yield* held.attachment.end(reason);
    yield* Scope.close(held.scope, Exit.void);
  });

  const attach = (host: string, pid: number): Stream.Stream<Order, GateRefusal<'channel-broken'>> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const generation = ++generations;
        const stale = attachments.get(host);
        if (stale !== undefined) yield* end(stale, `the host attached again as generation ${generation}`);
        const attachment = yield* makeAttachment({ id: host, generation, pid });
        const held: Held = { attachment, scope: yield* Scope.fork(scope), claimed: false };
        attachments.set(host, held);
        yield* Effect.addFinalizer(() => end(held, 'its attach feed ended'));
        const opening: Order = { kind: 'attached', generation };
        return Stream.concat(Stream.succeed(opening), attachment.feed);
      }),
    );

  const unknown = (host: string, generation: number) =>
    new GateRefusal('channel-unknown', `no attach feed of desktop host ${host} stands at generation ${generation}`, [
      'call attach_browser_host first and report under the generation it answered',
    ]);

  const report = Effect.fn('DesktopChannel.report')(function* (host: string, generation: number) {
    const held = attachments.get(host);
    if (held === undefined || held.attachment.generation !== generation || held.claimed || held.attachment.done()) {
      return yield* unknown(host, generation);
    }
    held.claimed = true;
    yield* Effect.addFinalizer(() => end(held, 'its report stream ended'));
    yield* Effect.forkIn(Scope.provide(hosts.attach(held.attachment.host), held.scope), held.scope);
    return { take: held.attachment.take, ended: held.attachment.ended };
  });

  const key = (service: string, account: string) => {
    const held = [...attachments.values()].findLast((standing) => standing.claimed && !standing.attachment.done());
    return held === undefined
      ? Effect.fail(
          new KeyUnavailable({
            reason: 'away',
            message: `the Tagma app is not connected to this server, and it reads the Keychain key ${service}`,
          }),
        )
      : held.attachment.key(service, account);
  };

  return Context.make(DesktopChannel, DesktopChannel.of({ attach, report })).pipe(
    Context.add(SafeStorageKey, SafeStorageKey.of({ read: key })),
  );
});

export const desktopChannelLayer = Layer.effectContext(makeDesktopChannel);
