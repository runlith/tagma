import type { Protocol } from 'devtools-protocol';
import { Effect } from 'effect';
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

export const retireChild = (state: Paged, attached: Attached, child: string): void => {
  for (const [frame, held] of attached.frames) if (held.child === child) retire(state, attached, frame);
};

export const commitFrame = (state: Paged, attached: Attached, frame: Protocol.Page.Frame, child: string | undefined): boolean => {
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

export const detachFrame = (
  state: Paged,
  attached: Attached,
  detached: Protocol.Page.FrameDetachedEvent,
  child: string | undefined,
): boolean => {
  if (detached.reason === 'swap' || attached.frames.get(detached.frameId)?.child !== child) return false;
  retire(state, attached, detached.frameId);
  return true;
};

export const joinChild = (state: Paged, attached: Attached, child: string, frame: string): void => {
  const outgoing = attached.sessions.get(frame);
  attached.children.set(child, frame);
  attached.sessions.set(frame, child);
  if (outgoing !== undefined && outgoing !== child) retireChild(state, attached, outgoing);
};

export const leaveChild = (attached: Attached, child: string): string | undefined => {
  const gone = attached.children.get(child);
  if (gone === undefined) return undefined;
  attached.settled.delete(child);
  attached.children.delete(child);
  if (attached.sessions.get(gone) === child) attached.sessions.delete(gone);
  return gone;
};
