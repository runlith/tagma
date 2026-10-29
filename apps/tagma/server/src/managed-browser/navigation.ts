import { type CommandFailure, type Connection, eventParams, type EventParams, type Result, type Session } from '@runlith/cdp/session';
import { Deferred, Effect, Exit, FiberSet, PubSub, Scope, Semaphore, Stream } from 'effect';
import { NavigationBlocked, type NavigationWatch } from '../browser/contract/service/hosts.js';
import {
  domainBlock,
  type DomainBlock,
  type DomainPolicy,
  type Restriction,
  type RestrictionState,
} from '../browser/contract/wire/domains.js';
import type { HostEvent } from '../browser/contract/wire/host.js';
import type { PageId } from '../browser/contract/wire/ids.js';
import { quiet } from './targets.js';

type FrameTree = Result<'Page.getFrameTree'>['frameTree'];
type TargetInfo = EventParams<'Target.targetCreated'>['targetInfo'];
type Blocked = { readonly error: NavigationBlocked };
type Watching = { readonly failed: Deferred.Deferred<never, NavigationBlocked>; block: Blocked | null };
type Gate = {
  target: string;
  policy: DomainPolicy;
  source: Gate | null;
  pending: Blocked | null;
  watching: Watching | null;
};
type Bound = {
  readonly page: PageId | null;
  readonly service: Session;
  readonly frames: Set<string>;
  readonly temporary: Scope.Closeable | null;
};
type Auxiliary = { readonly root: string; readonly scope: Scope.Closeable };

export const makeNavigation = Effect.fnUntraced(function* (input: {
  readonly connection: Connection;
  readonly events: PubSub.PubSub<HostEvent>;
  readonly nextRevision: () => number;
}) {
  const { connection, events, nextRevision } = input;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const work = yield* FiberSet.make<void, never>();
  const gates = new Map<string, Gate>();
  const revisions = new Map<string, number>();
  const bound = new Map<string, Bound>();
  const auxiliary = new Map<string, Auxiliary>();
  const frames = new Map<string, string>();
  const openers = new Map<string, string | null>();
  const children = new Map<string, Set<string>>();
  const waiting = new Map<string, Deferred.Deferred<string | null>>();
  let enabled = false;

  const emit = (event: HostEvent) => Effect.asVoid(PubSub.publish(events, event));
  const pageOf = (target: string): PageId | null => bound.get(frames.get(target) ?? target)?.page ?? null;
  const gateOf = (target: string): Gate | undefined => gates.get(frames.get(target) ?? target);
  const stamp = (target: string, restricted: boolean) => {
    if (!revisions.has(target) || gates.has(target) !== restricted) revisions.set(target, nextRevision());
  };
  const stateOf = (target: string): RestrictionState => ({ restricted: gates.has(target), revision: revisions.get(target)! });
  const relate = (target: string, opener: string | null) => {
    const previous = openers.get(target);
    if (previous === opener) return;
    if (previous !== undefined && previous !== null) {
      const related = children.get(previous);
      related?.delete(target);
      if (related?.size === 0) children.delete(previous);
    }
    openers.set(target, opener);
    if (opener === null) return;
    const related = children.get(opener) ?? new Set<string>();
    related.add(target);
    children.set(opener, related);
  };
  const remember = (info: TargetInfo) => {
    if (info.type !== 'page') return;
    stamp(info.targetId, gates.has(info.targetId));
    if (openers.has(info.targetId)) return;
    const opener = info.openerId ?? info.openerFrameId;
    relate(info.targetId, opener === undefined ? null : (frames.get(opener) ?? opener));
  };
  function* family(target: string) {
    let root = target;
    for (;;) {
      const opener = openers.get(root);
      if (opener === undefined || opener === null) break;
      root = opener;
    }
    for (const pending = [root]; pending.length > 0;) {
      const member = pending.pop()!;
      yield member;
      for (const child of children.get(member) ?? []) pending.push(child);
    }
  }
  const propagate = (target: string, policy: DomainPolicy | null): readonly Restriction[] => {
    let initiating: Gate | null = null;
    if (policy !== null) {
      stamp(target, true);
      initiating = gates.get(target) ?? { target, policy, source: null, pending: null, watching: null };
      initiating.policy = policy;
      initiating.source = null;
      gates.set(target, initiating);
    }
    const changes: Restriction[] = [];
    for (const member of family(target)) {
      stamp(member, policy !== null);
      const held = gates.get(member);
      const source = member === target ? null : initiating;
      if (policy === null) {
        if (held !== undefined) {
          held.pending = null;
          held.watching = null;
          held.source = null;
          gates.delete(member);
        }
      } else if (held === undefined) gates.set(member, { target: member, policy, source, pending: null, watching: null });
      else {
        held.policy = policy;
        held.source = source;
      }
      const page = pageOf(member);
      if (page !== null) changes.push({ page, ...stateOf(member) });
    }
    return changes;
  };
  const contract = (target: string) => {
    const removed = gates.get(target);
    if (removed !== undefined) {
      const source = removed.source;
      const successor = source !== null && gates.get(source.target) === source ? source : null;
      for (const member of family(target)) {
        const gate = gates.get(member);
        if (gate !== undefined && gate.source === removed) gate.source = successor;
      }
      removed.pending = null;
      removed.watching = null;
      removed.source = null;
      gates.delete(target);
    }
    let parent = openers.get(target) ?? null;
    for (const child of children.get(target) ?? []) {
      relate(child, parent);
      parent ??= child;
    }
    relate(target, null);
    openers.delete(target);
  };
  const frame = Effect.fnUntraced(function* (id: string, target: string) {
    frames.set(id, target);
    if (id !== target) for (const child of children.get(id) ?? []) relate(child, target);
    bound.get(target)?.frames.add(id);
    const found = waiting.get(id);
    if (found !== undefined) yield* Deferred.succeed(found, target);
  });
  const detached = Effect.fnUntraced(function* (id: string) {
    const target = frames.get(id);
    if (target !== undefined) bound.get(target)?.frames.delete(id);
    frames.delete(id);
    const found = waiting.get(id);
    if (found !== undefined) yield* Deferred.succeed(found, null);
  });
  const treeOf = Effect.fnUntraced(function* (target: string, tree: FrameTree) {
    for (const nested = [tree]; nested.length > 0;) {
      const node = nested.pop()!;
      yield* frame(node.frame.id, target);
      nested.push(...(node.childFrames ?? []));
    }
  });
  const routeOf = Effect.fnUntraced(function* (id: string) {
    const target = frames.get(id);
    if (target !== undefined) return target;
    const found = waiting.get(id) ?? (yield* Deferred.make<string | null>());
    waiting.set(id, found);
    const current = frames.get(id);
    if (current !== undefined) {
      if (waiting.get(id) === found) waiting.delete(id);
      return current;
    }
    return yield* Deferred.await(found).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (waiting.get(id) === found) waiting.delete(id);
        }),
      ),
    );
  });

  const follow = Effect.fnUntraced(function* (target: string, service: Session) {
    const events = yield* service.events((method) => method === 'Page.frameAttached' || method === 'Page.frameDetached');
    yield* Stream.runForEach(events, (event) =>
      Effect.gen(function* () {
        if (event.child !== undefined) return;
        if (event.method === 'Page.frameAttached') yield* frame((yield* eventParams('Page.frameAttached', event)).frameId, target);
        else {
          const { frameId, reason } = yield* eventParams('Page.frameDetached', event);
          if (reason === 'remove') yield* detached(frameId);
        }
      }).pipe(quiet(`following the frames of target ${target}`)),
    ).pipe(Effect.forkScoped);
  });

  const temporary = Effect.fnUntraced(function* (target: string, root: string, page: boolean) {
    yield* lock.withPermit(
      Effect.gen(function* () {
        if (gates.size === 0 || (page ? bound.has(target) : auxiliary.has(target))) return;
        const held = yield* Scope.fork(scope);
        yield* Effect.gen(function* () {
          const { sessionId } = yield* connection.root.send('Target.attachToTarget', { targetId: target, flatten: true });
          yield* Scope.provide(
            Effect.addFinalizer(() =>
              connection.root.send('Target.detachFromTarget', { sessionId }).pipe(quiet(`releasing navigation session ${target}`)),
            ),
            held,
          );
          const service = yield* Scope.provide(connection.attach(sessionId), held);
          if (page) bound.set(target, { page: null, service, frames: new Set(), temporary: held });
          else auxiliary.set(target, { root, scope: held });
          yield* frame(target, root);
          yield* Scope.provide(follow(root, service), held);
          yield* FiberSet.run(
            work,
            Effect.gen(function* () {
              yield* service.send('Page.enable');
              yield* treeOf(root, (yield* service.send('Page.getFrameTree')).frameTree);
            }).pipe(quiet(`establishing the frames of target ${target}`)),
          );
        }).pipe(Effect.onError(() => Scope.close(held, Exit.void)));
      }),
    );
  });

  const inherit = (info: TargetInfo) => {
    remember(info);
    if (info.type !== 'page' || gates.has(info.targetId)) return;
    const source = gateOf(openers.get(info.targetId) ?? '');
    if (source !== undefined) {
      stamp(info.targetId, true);
      gates.set(info.targetId, { target: info.targetId, policy: source.policy, source, pending: null, watching: null });
    }
  };
  const created = Effect.fnUntraced(function* (info: TargetInfo) {
    if (gates.size === 0) return;
    if (info.type === 'page') {
      inherit(info);
      yield* temporary(info.targetId, info.targetId, true);
    } else if (info.type === 'iframe') {
      const root = yield* routeOf(info.parentId ?? info.parentFrameId ?? info.targetId);
      if (root !== null) yield* temporary(info.targetId, root, false);
    }
  });

  const switchFetch = Effect.fnUntraced(function* (targetInfos: readonly TargetInfo[] = []) {
    const needed = gates.size > 0;
    if (needed === enabled) return;
    if (needed) {
      yield* connection.root.send('Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] });
      enabled = true;
      for (const info of targetInfos) yield* FiberSet.run(work, created(info).pipe(quiet(`following navigation target ${info.targetId}`)));
    } else {
      yield* connection.root.send('Fetch.disable');
      enabled = false;
      for (const found of waiting.values()) yield* Deferred.succeed(found, null);
      for (const [target, held] of auxiliary) {
        auxiliary.delete(target);
        yield* Scope.close(held.scope, Exit.void);
      }
      for (const [target, held] of bound) {
        if (held.temporary === null) continue;
        bound.delete(target);
        for (const id of held.frames) yield* detached(id);
        yield* Scope.close(held.temporary, Exit.void);
      }
    }
  });

  const report = Effect.fnUntraced(function* (gate: Gate, block: DomainBlock): Effect.fn.Return<void> {
    if (gate.watching?.block === null || gate.watching === null) {
      const token = gate.pending ?? {
        error: new NavigationBlocked({ ...block, message: `${block.domain} is blocked by ${block.setting}` }),
      };
      gate.pending = token;
      if (gate.watching !== null) {
        gate.watching.block = token;
        yield* Deferred.fail(gate.watching.failed, token.error);
      }
    }
    const page = pageOf(gate.target);
    if (page !== null) yield* emit({ kind: 'navigation-blocked', page, block });
    if (gate.source !== null && gates.get(gate.source.target) === gate.source) yield* report(gate.source, block);
  });

  const resolve = Effect.fnUntraced(function* (id: string) {
    const known = frames.get(id);
    if (known !== undefined) return known;
    const target = yield* connection.root.send('Target.getTargetInfo', { targetId: id }).pipe(
      Effect.catchIf(
        (failure) => failure._tag === 'CommandRefused' && failure.message === 'No target with given id found',
        () => Effect.succeed(null),
      ),
    );
    if (target !== null) yield* created(target.targetInfo);
    return yield* routeOf(id);
  });

  const configure = Effect.fnUntraced(function* (target: string, policy: DomainPolicy | null) {
    const active = policy !== null && (policy.blocked.length > 0 || policy.allowed.length > 0) ? policy : null;
    const targetInfos: readonly TargetInfo[] =
      active !== null && !enabled
        ? (yield* connection.root.send('Target.getTargets', { filter: [{ type: 'page' }, { type: 'iframe' }] })).targetInfos
        : [];
    for (const info of targetInfos) remember(info);
    const changes = propagate(target, active);
    yield* switchFetch(targetInfos);
    return { gate: gates.get(target), changes };
  });

  const request = Effect.fn('ManagedHost.navigationRequest')(function* (request: EventParams<'Fetch.requestPaused'>) {
    const target = gates.size === 0 ? null : yield* resolve(request.frameId);
    yield* lock.withPermit(
      Effect.gen(function* () {
        const gate = target === null ? undefined : gates.get(target);
        const block = gate === undefined ? null : domainBlock(gate.policy, request.request.url);
        if (block === null || gate === undefined) {
          yield* connection.root.send('Fetch.continueRequest', { requestId: request.requestId });
          return;
        }
        yield* report(gate, block);
        yield* connection.root.send('Fetch.failRequest', { requestId: request.requestId, errorReason: 'BlockedByClient' });
      }),
    );
  });

  return {
    page: pageOf,
    state: stateOf,
    tree: treeOf,
    bind: Effect.fnUntraced(function* (target: string, page: PageId, service: Session) {
      const held = yield* Effect.scope;
      yield* lock.withPermit(
        Effect.gen(function* () {
          const previous = bound.get(target);
          stamp(target, gates.has(target));
          bound.set(target, { page, service, frames: previous?.frames ?? new Set(), temporary: null });
          yield* frame(target, target);
          yield* Scope.provide(follow(target, service), held);
          if (previous?.temporary !== null && previous?.temporary !== undefined) yield* Scope.close(previous.temporary, Exit.void);
          const pending = gates.get(target)?.pending;
          if (pending !== null && pending !== undefined) {
            const { domain, setting } = pending.error;
            yield* emit({ kind: 'navigation-blocked', page, block: { domain, setting } });
          }
        }),
      );
    }),
    created: (info: TargetInfo) =>
      Effect.suspend(() => {
        remember(info);
        if (gates.size === 0) return Effect.void;
        inherit(info);
        return Effect.asVoid(FiberSet.run(work, created(info).pipe(quiet(`following navigation target ${info.targetId}`))));
      }),
    open: (target: string, policy: DomainPolicy | null) => Effect.asVoid(lock.withPermit(configure(target, policy))),
    watch: Effect.fn('ManagedHost.navigation')(function* (
      target: string,
      policy: DomainPolicy | null,
    ): Effect.fn.Return<NavigationWatch, CommandFailure, Scope.Scope> {
      return yield* lock.withPermit(
        Effect.gen(function* () {
          const { gate, changes } = yield* configure(target, policy);
          if (gate === undefined) return { blocked: Effect.never, check: Effect.void, changes };
          const watching: Watching = { failed: yield* Deferred.make<never, NavigationBlocked>(), block: gate.pending };
          gate.watching = watching;
          if (watching.block !== null) yield* Deferred.fail(watching.failed, watching.block.error);
          const acknowledge = Effect.sync(() => {
            if (gate.pending === watching.block) gate.pending = null;
          });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (gate.watching === watching) gate.watching = null;
            }),
          );
          return {
            changes,
            blocked: Deferred.await(watching.failed).pipe(Effect.tapError(() => acknowledge)),
            check: Effect.suspend(() =>
              watching.block === null ? Effect.void : Effect.andThen(acknowledge, Effect.fail(watching.block.error)),
            ),
          };
        }),
      );
    }),
    check: Effect.fnUntraced(function* (target: string, url: string) {
      return yield* lock.withPermit(
        Effect.gen(function* () {
          const gate = gateOf(target);
          const block = gate === undefined ? null : domainBlock(gate.policy, url);
          if (block === null || gate === undefined) return;
          yield* report(gate, block);
          return yield* new NavigationBlocked({ ...block, message: `${block.domain} is blocked by ${block.setting}` });
        }),
      );
    }),
    request: (paused: EventParams<'Fetch.requestPaused'>) =>
      Effect.asVoid(FiberSet.run(work, request(paused).pipe(quiet('checking a document navigation')))),
    forget: Effect.fnUntraced(function* (target: string) {
      yield* lock.withPermit(
        Effect.gen(function* () {
          const nested = auxiliary.get(target);
          if (nested !== undefined) {
            auxiliary.delete(target);
            yield* detached(target);
            yield* Scope.close(nested.scope, Exit.void);
          }
          const binding = bound.get(target);
          if (binding !== undefined) {
            for (const id of binding.frames) yield* detached(id);
            bound.delete(target);
            if (binding.temporary !== null) yield* Scope.close(binding.temporary, Exit.void);
            for (const [id, held] of auxiliary) {
              if (held.root !== target) continue;
              auxiliary.delete(id);
              yield* Scope.close(held.scope, Exit.void);
            }
          }
          contract(target);
          revisions.delete(target);
          yield* switchFetch();
        }),
      );
    }),
    swap: (previous: string, target: string) =>
      Effect.sync(() => {
        revisions.set(target, revisions.get(previous)!);
        revisions.delete(previous);
        const opener = openers.get(previous) ?? null;
        relate(previous, null);
        openers.delete(previous);
        relate(target, opener);
        for (const child of children.get(previous) ?? []) relate(child, target);
        const gate = gates.get(previous);
        if (gate === undefined) return;
        gates.delete(previous);
        gate.target = target;
        gates.set(target, gate);
      }),
  };
});

export type NavigationGate = Effect.Success<ReturnType<typeof makeNavigation>>;
