import type { Protocol } from 'devtools-protocol';
import { Effect, Exit, PubSub, Scope } from 'effect';
import { type CdpEvent, eventParams } from '@runlith/cdp/session';
import type { FrameTarget, Pages } from '../contract/service/pages.js';
import { applyConditions } from './emulate.js';
import { adoptPicking } from './cursor.js';
import type { Attached, Paged } from './drive.js';

export type Frame = { readonly loader: string; readonly child: string | undefined; readonly url: string; readonly parent: string | null };

export const readTree = Effect.fnUntraced(function* (attached: Attached, child: string | undefined) {
  const { frameTree } = yield* attached.session.send('Page.getFrameTree', undefined, child);
  if (child !== undefined && attached.sessions.get(frameTree.frame.id) !== child) return false;
  const walk = (tree: Protocol.Page.FrameTree): void => {
    const owner = attached.sessions.get(tree.frame.id);
    if (owner !== undefined && owner !== child) return;
    const parent = tree.frame.parentId ?? attached.frames.get(tree.frame.id)?.parent ?? null;
    attached.frames.set(tree.frame.id, { loader: tree.frame.loaderId, child, url: tree.frame.url, parent });
    for (const nested of tree.childFrames ?? []) walk(nested);
  };
  walk(frameTree);
  if (child === undefined) attached.main = frameTree.frame.id;
  return true;
});

const retire = (state: Paged, attached: Attached, id: string): void => {
  const gone = attached.frames.get(id);
  if (gone === undefined) return;
  state.refs.retire(gone.loader);
  attached.worlds.delete(`${id}|${gone.loader}`);
  attached.frames.delete(id);
};

const retireChild = (state: Paged, attached: Attached, child: string): void => {
  for (const [frame, held] of attached.frames) if (held.child === child) retire(state, attached, frame);
};

const commitFrame = (state: Paged, attached: Attached, frame: Protocol.Page.Frame, child: string | undefined): boolean => {
  if (child !== undefined) {
    const root = attached.children.get(child);
    if (root === undefined || attached.sessions.get(root) !== child) return false;
  }
  const owner = attached.sessions.get(frame.id);
  if (owner !== undefined && owner !== child) return false;
  const before = attached.frames.get(frame.id);
  if (before !== undefined && before.loader !== frame.loaderId) {
    const children = new Map<string, string[]>();
    for (const [id, held] of attached.frames) {
      if (held.parent === null) continue;
      const siblings = children.get(held.parent) ?? [];
      siblings.push(id);
      children.set(held.parent, siblings);
    }
    for (const pending = [frame.id]; pending.length > 0;) {
      const id = pending.pop()!;
      retire(state, attached, id);
      pending.push(...(children.get(id) ?? []));
    }
  }
  attached.frames.set(frame.id, { loader: frame.loaderId, child, url: frame.url, parent: frame.parentId ?? before?.parent ?? null });
  if (frame.parentId === undefined && child === undefined) attached.main = frame.id;
  return true;
};

const detachFrame = (state: Paged, attached: Attached, detached: Protocol.Page.FrameDetachedEvent, child: string | undefined): boolean => {
  if (detached.reason === 'swap' || attached.frames.get(detached.frameId)?.child !== child) return false;
  retire(state, attached, detached.frameId);
  return true;
};

const joinChild = (state: Paged, attached: Attached, child: string, frame: string, through: string | undefined): void => {
  const outgoing = attached.sessions.get(frame);
  attached.children.set(child, frame);
  attached.sessions.set(frame, child);
  if (through !== undefined) attached.through.set(child, through);
  if (outgoing !== undefined && outgoing !== child) retireChild(state, attached, outgoing);
};

type ChildSession = { readonly child: string; readonly frame: string };

const leaveChild = (attached: Attached, child: string): readonly ChildSession[] => {
  const nested = new Map<string, string[]>();
  for (const [session, parent] of attached.through) {
    const siblings = nested.get(parent) ?? [];
    siblings.push(session);
    nested.set(parent, siblings);
  }
  const left: ChildSession[] = [];
  for (const pending = [child]; pending.length > 0;) {
    const session = pending.pop()!;
    const gone = attached.children.get(session);
    if (gone === undefined) continue;
    attached.settled.delete(session);
    attached.children.delete(session);
    attached.through.delete(session);
    if (attached.sessions.get(gone) === session) attached.sessions.delete(gone);
    left.push({ child: session, frame: gone });
    pending.push(...(nested.get(session) ?? []));
  }
  return left;
};

const adoptChild = Effect.fnUntraced(function* (state: Paged, attached: Attached, child: string, adopted: Scope.Closeable) {
  yield* attached.emulating.withPermits(1)(Effect.suspend(() => applyConditions(attached.session, state.emulation, undefined, child)));
  const domains =
    attached.input === 'human'
      ? (['Page', 'DOM', 'Accessibility'] as const)
      : (['Page', 'DOM', 'Network', 'Log', 'Accessibility'] as const);
  for (const domain of domains) yield* Scope.provide(attached.domains.enable(domain, child), adopted);
  if (attached.runtime !== null) yield* Scope.provide(attached.domains.enable('Runtime', child), attached.runtime);
  yield* attached.session.send('Emulation.setFocusEmulationEnabled', { enabled: true }, child);
  yield* attached.session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, child);
  if (!(yield* readTree(attached, child))) return;
  yield* adoptPicking(state, attached, child);
});

export const frameEvent = Effect.fnUntraced(function* (state: Paged, attached: Attached, event: CdpEvent, pages: Pages['Service']) {
  switch (event.method) {
    case 'Page.frameNavigated': {
      const { frame } = yield* eventParams('Page.frameNavigated', event);
      if (!commitFrame(state, attached, frame, event.child)) return 'handled' as const;
      if (frame.parentId === undefined && event.child === undefined) return { navigation: frame.id };
      yield* PubSub.publish(attached.joined, frame.id);
      return 'handled' as const;
    }
    case 'Page.frameStartedNavigating': {
      const { frameId } = yield* eventParams('Page.frameStartedNavigating', event);
      if (frameId !== attached.main || event.child !== undefined) return 'handled' as const;
      attached.navigations += 1;
      yield* PubSub.publish(attached.joined, frameId);
      return 'handled' as const;
    }
    case 'Page.frameDetached': {
      const detached = yield* eventParams('Page.frameDetached', event);
      if (detachFrame(state, attached, detached, event.child)) yield* PubSub.publish(attached.joined, detached.frameId);
      return 'handled' as const;
    }
    case 'Target.attachedToTarget': {
      const joined = yield* eventParams('Target.attachedToTarget', event);
      if (attached.pictures.accepts(joined.targetInfo)) return 'handled' as const;
      if (joined.targetInfo.type !== 'iframe') {
        yield* Effect.exit(attached.session.send('Target.detachFromTarget', { sessionId: joined.sessionId }));
        return 'handled' as const;
      }
      joinChild(state, attached, joined.sessionId, joined.targetInfo.targetId, event.child);
      const adopted = yield* Scope.fork(attached.scope);
      attached.adopted.set(joined.sessionId, adopted);
      const target: FrameTarget = { session: joined.sessionId, frame: joined.targetInfo.targetId, url: joined.targetInfo.url };
      yield* Scope.addFinalizer(adopted, pages.mark(state.page, { responsive: true }, target));
      yield* adoptChild(state, attached, joined.sessionId, adopted).pipe(
        Effect.catchTags({
          SessionEnded: () => Effect.void,
          CommandRefused: (refused) =>
            Effect.logDebug(`browser: an out-of-process frame of ${state.page} was not adopted: ${refused.method}: ${refused.message}`),
        }),
        Effect.ensuring(
          Effect.suspend(() => {
            attached.settled.add(joined.sessionId);
            return PubSub.publish(attached.joined, joined.targetInfo.targetId);
          }),
        ),
        Effect.forkIn(adopted),
      );
      return 'handled' as const;
    }
    case 'Target.detachedFromTarget': {
      const { sessionId } = yield* eventParams('Target.detachedFromTarget', event);
      if (sessionId === undefined) return 'handled' as const;
      for (const { child, frame } of leaveChild(attached, sessionId)) {
        yield* PubSub.publish(attached.joined, frame);
        retireChild(state, attached, child);
        const adopted = attached.adopted.get(child);
        attached.adopted.delete(child);
        if (adopted !== undefined) yield* Scope.close(adopted, Exit.void);
      }
      return 'handled' as const;
    }
    default:
      return null;
  }
});
