import type { Point } from '@runlith/cdp/input';
import type { CommandFailure } from '@runlith/cdp/session';
import { Effect, PubSub, Stream } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Attached, Paged } from './drive.js';
import type { Anchor } from './refs.js';

const WORLD = 'automation';

export type Located = {
  readonly ref: string;
  readonly anchor: Anchor;
  readonly child: string | undefined;
  readonly object: string;
};

export const staleRef = (ref: string) =>
  new GateRefusal('stale-ref', `${ref} belongs to a document that has since been replaced, or was never issued for this page`, [
    'snapshot_page — read the page again and use its references',
  ]);

export const actionFailed = (reason: string) =>
  new GateRefusal('action-failed', reason, ['snapshot_page — read the page again and act on what it shows']);

export const world = Effect.fnUntraced(function* (
  attached: Attached,
  frame: string,
): Effect.fn.Return<number, CommandFailure | GateRefusal<'stale-ref'>> {
  const held = attached.frames.get(frame);
  if (held === undefined) return yield* staleRef(frame);
  const key = `${frame}|${held.loader}`;
  const known = attached.worlds.get(key);
  if (known !== undefined) return known;
  const { executionContextId } = yield* attached.session.send('Page.createIsolatedWorld', { frameId: frame, worldName: WORLD }, held.child);
  attached.worlds.set(key, executionContextId);
  return executionContextId;
});

export const locate = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  ref: string,
): Effect.fn.Return<Located, CommandFailure | GateRefusal<'stale-ref'>> {
  const anchor = state.refs.anchor(ref);
  const frame = anchor === undefined ? undefined : attached.frames.get(anchor.frame);
  if (anchor === undefined || frame === undefined || frame.loader !== anchor.loader) return yield* staleRef(ref);
  const context = yield* world(attached, anchor.frame);
  const resolved = yield* attached.session
    .send('DOM.resolveNode', { backendNodeId: anchor.node, executionContextId: context, objectGroup: attached.group }, frame.child)
    .pipe(Effect.catchTag('CommandRefused', () => Effect.fail(staleRef(ref))));
  if (resolved.object.objectId === undefined) return yield* staleRef(ref);
  return { ref, anchor, child: frame.child, object: resolved.object.objectId };
});

export const anchorOf = (attached: Attached, frame: string, node: number): Anchor | undefined => {
  const held = attached.frames.get(frame);
  return held === undefined
    ? undefined
    : { target: attached.children.get(held.child ?? '') ?? attached.main, loader: held.loader, frame, node };
};

export const call = Effect.fnUntraced(function* <A>(
  attached: Attached,
  located: Located,
  functionDeclaration: string,
  args: readonly unknown[] = [],
): Effect.fn.Return<A, CommandFailure | GateRefusal<'action-failed'>> {
  const reply = yield* attached.session.send(
    'Runtime.callFunctionOn',
    { objectId: located.object, functionDeclaration, arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true },
    located.child,
  );
  if (reply.exceptionDetails !== undefined) {
    return yield* actionFailed(
      `the page threw while the engine read ${located.ref}: ${reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text}`,
    );
  }
  return reply.result.value as A;
});

const center = (quad: readonly number[]): Point => ({
  x: (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4,
  y: (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4,
});

type FrameOwner = { readonly node: number; readonly child: string | undefined };
type Offset = Point & { readonly owners: readonly FrameOwner[]; readonly points: readonly Point[] };

const offsetOf = Effect.fnUntraced(function* (
  attached: Attached,
  child: string | undefined,
  known?: readonly FrameOwner[],
): Effect.fn.Return<Offset, CommandFailure> {
  const owners = known === undefined ? [] : [...known];
  if (known === undefined) {
    let at = child;
    while (at !== undefined) {
      const root = attached.children.get(at);
      const parent = root === undefined ? undefined : attached.frames.get(root)?.parent;
      if (root === undefined || parent === null || parent === undefined) break;
      const parentChild = attached.frames.get(parent)?.child;
      const owner = yield* attached.session.send('DOM.getFrameOwner', { frameId: root }, parentChild);
      owners.push({ node: owner.backendNodeId, child: parentChild });
      at = parentChild;
    }
  }
  const points = yield* Effect.forEach(
    owners,
    Effect.fnUntraced(function* (owner) {
      const box = yield* attached.session.send('DOM.getBoxModel', { backendNodeId: owner.node }, owner.child);
      return { x: box.model.content[0]!, y: box.model.content[1]! };
    }),
  );
  return { x: points.reduce((sum, point) => sum + point.x, 0), y: points.reduce((sum, point) => sum + point.y, 0), owners, points };
});

export type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

type PlacedBox = Box & { readonly center: Point; readonly localCenter: Point };
type Measured = { readonly box: PlacedBox | null; readonly offset: Offset };

const measureBox = Effect.fnUntraced(function* (
  attached: Attached,
  located: Located,
  owners?: readonly FrameOwner[],
): Effect.fn.Return<Measured, CommandFailure> {
  const { quads } = yield* attached.session
    .send('DOM.getContentQuads', { backendNodeId: located.anchor.node }, located.child)
    .pipe(Effect.catchTag('CommandRefused', () => Effect.succeed({ quads: [] as number[][] })));
  const quad = quads.find((held) => Math.abs((held[4]! - held[0]!) * (held[5]! - held[1]!)) > 1);
  const offset = yield* offsetOf(attached, located.child, owners);
  if (quad === undefined) return { box: null, offset };
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  const middle = center(quad);
  return {
    box: {
      x: Math.min(...xs) + offset.x,
      y: Math.min(...ys) + offset.y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      center: { x: middle.x + offset.x, y: middle.y + offset.y },
      localCenter: middle,
    },
    offset,
  };
});

export const boxOf = Effect.fn('browser.box')(function* (
  attached: Attached,
  located: Located,
  shouldReveal = true,
): Effect.fn.Return<PlacedBox, CommandFailure | GateRefusal<'action-failed'>> {
  const before = shouldReveal ? yield* measureBox(attached, located) : null;
  if (shouldReveal)
    yield* attached.session
      .send('DOM.scrollIntoViewIfNeeded', { backendNodeId: located.anchor.node }, located.child)
      .pipe(Effect.catchTag('CommandRefused', () => Effect.void));
  const after = yield* measureBox(attached, located, before?.offset.owners);
  const box = after.box;
  if (box === null) return yield* actionFailed(`${located.ref} has no visible box to aim at`);
  if (
    before !== null &&
    (before.box === null ||
      before.box.localCenter.x !== box.localCenter.x ||
      before.box.localCenter.y !== box.localCenter.y ||
      before.offset.points.some((point, index) => point.x !== after.offset.points[index]!.x || point.y !== after.offset.points[index]!.y))
  ) {
    yield* attached.pictures.paint;
  }
  return box;
});

export const pointOf = (attached: Attached, located: Located): Effect.Effect<Point, CommandFailure | GateRefusal<'action-failed'>> =>
  Effect.map(boxOf(attached, located), (box) => box.localCenter);

const COVERS = `function (hit) { let at = hit; while (at) { if (at === this) return true; at = at.parentNode || at.host || at.parent || null; } return false; }`;

const NAMED = `function () {
  const element = this.nodeType === 1 ? this : this.parentElement || this.element;
  if (!element) return '#text';
  const id = element.id ? '#' + element.id : '';
  const kind = typeof element.className === 'string' && element.className.trim() ? '.' + element.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
  const text = (element.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  return '<' + element.localName + id + kind + '>' + (text ? ' "' + text + '"' : '');
}`;

export const describe = (attached: Attached, located: Located) => call<string>(attached, located, NAMED);

export type Covered = { readonly ref: string | null; readonly named: string };

const hitAt = Effect.fnUntraced(function* (attached: Attached, child: string | undefined, at: Point) {
  const { cssLayoutViewport } = yield* attached.session.send('Page.getLayoutMetrics', undefined, child);
  return yield* attached.session
    .send(
      'DOM.getNodeForLocation',
      {
        x: Math.round(at.x + cssLayoutViewport.pageX),
        y: Math.round(at.y + cssLayoutViewport.pageY),
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: false,
      },
      child,
    )
    .pipe(Effect.catchTag('CommandRefused', () => Effect.succeed(null)));
});

const nameOf = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  child: string | undefined,
  frame: string,
  node: number,
  object: string,
): Effect.fn.Return<Covered, CommandFailure> {
  const named = yield* attached.session.send(
    'Runtime.callFunctionOn',
    { objectId: object, functionDeclaration: NAMED, returnByValue: true },
    child,
  );
  const anchor = anchorOf(attached, frame, node);
  return { ref: anchor === undefined ? null : state.refs.issue(anchor), named: String(named.result.value) };
});

const resolvedIn = Effect.fnUntraced(function* (attached: Attached, child: string | undefined, frame: string, node: number) {
  const context = yield* world(attached, frame).pipe(Effect.catchTag('GateRefusal', () => Effect.succeed(null)));
  if (context === null) return null;
  const resolved = yield* attached.session.send(
    'DOM.resolveNode',
    { backendNodeId: node, executionContextId: context, objectGroup: attached.group },
    child,
  );
  return resolved.object.objectId ?? null;
});

const ownerOf = Effect.fnUntraced(function* (attached: Attached, child: string): Effect.fn.Return<number | null, CommandFailure> {
  let root = attached.children.get(child);
  while (root !== undefined) {
    const parent = attached.frames.get(root)?.parent;
    if (parent === null || parent === undefined) return null;
    const parentChild = attached.frames.get(parent)?.child;
    if (parentChild === undefined) return (yield* attached.session.send('DOM.getFrameOwner', { frameId: root })).backendNodeId;
    root = attached.children.get(parentChild);
  }
  return null;
});

export const coverOf = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  located: Located,
  at: Point,
): Effect.fn.Return<Covered | null, CommandFailure | GateRefusal<'action-failed'>> {
  let local = at;
  if (located.child !== undefined) {
    const owner = yield* ownerOf(attached, located.child);
    const outer = yield* hitAt(attached, undefined, at);
    if (outer === null) return { ref: null, named: 'nothing at that point of the viewport' };
    if (owner !== null && outer.backendNodeId !== owner) {
      const frame = outer.frameId ?? attached.main;
      const object = yield* resolvedIn(attached, undefined, frame, outer.backendNodeId);
      return object === null
        ? { ref: null, named: 'another frame' }
        : yield* nameOf(state, attached, undefined, frame, outer.backendNodeId, object);
    }
    const offset = yield* offsetOf(attached, located.child);
    local = { x: at.x - offset.x, y: at.y - offset.y };
  }
  const hit = yield* hitAt(attached, located.child, local);
  if (hit === null) return { ref: null, named: 'nothing at that point of the viewport' };
  const frame = hit.frameId ?? located.anchor.frame;
  const object = yield* resolvedIn(attached, located.child, frame, hit.backendNodeId);
  if (object === null) return { ref: null, named: 'another frame' };
  if (frame === located.anchor.frame) {
    const covers = yield* attached.session.send(
      'Runtime.callFunctionOn',
      { objectId: located.object, functionDeclaration: COVERS, arguments: [{ objectId: object }], returnByValue: true },
      located.child,
    );
    if (covers.result.value === true) return null;
  }
  return yield* nameOf(state, attached, located.child, frame, hit.backendNodeId, object);
});

const innerOf = Effect.fnUntraced(function* (
  attached: Attached,
  child: string | undefined,
  node: number,
): Effect.fn.Return<string | undefined, CommandFailure> {
  for (const [inner, root] of attached.children) {
    const parent = attached.frames.get(root)?.parent;
    if (parent === null || parent === undefined || attached.frames.get(parent)?.child !== child) continue;
    const owner = yield* attached.session
      .send('DOM.getFrameOwner', { frameId: root }, child)
      .pipe(Effect.catchTag('CommandRefused', () => Effect.succeed(null)));
    if (owner?.backendNodeId === node) return inner;
  }
  return undefined;
});

const joining = Effect.fnUntraced(function* (
  attached: Attached,
  child: string | undefined,
  node: number,
): Effect.fn.Return<boolean, CommandFailure> {
  const { node: described } = yield* attached.session.send('DOM.describeNode', { backendNodeId: node }, child);
  const remote = described.frameId;
  if (remote === undefined || described.contentDocument !== undefined) return false;
  const childSession = attached.sessions.get(remote);
  if (childSession !== undefined && attached.settled.has(childSession)) return false;
  yield* joined(attached, remote, childSession);
  return true;
});

export const joined = (attached: Attached, remote: string, child = attached.sessions.get(remote)): Effect.Effect<void> => {
  if (child !== undefined && attached.settled.has(child)) return Effect.void;
  const navigations = attached.navigations;
  const known = attached.frames.has(remote);
  return until(attached, () => {
    const current = child ?? attached.sessions.get(remote);
    return (
      (current !== undefined && attached.settled.has(current)) ||
      (child !== undefined
        ? attached.children.get(child) !== remote
        : attached.navigations !== navigations || (known && !attached.frames.has(remote)))
    );
  });
};

const until = (attached: Attached, done: () => boolean): Effect.Effect<void> =>
  done()
    ? Effect.void
    : Effect.scoped(
        Effect.gen(function* () {
          const heard = yield* PubSub.subscribe(attached.joined);
          if (done()) return;
          yield* Effect.raceFirst(
            Effect.asVoid(Stream.runHead(Stream.filter(Stream.fromSubscription(heard), done))),
            Effect.asVoid(attached.session.ended),
          );
        }),
      );

export const locateAt = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  at: Point,
): Effect.fn.Return<Located, CommandFailure | GateRefusal<'action-failed'>> {
  let child: string | undefined;
  let local = at;
  for (;;) {
    const hit = yield* hitAt(attached, child, local);
    if (hit === null) return yield* actionFailed(`nothing stands at ${at.x}, ${at.y} of the viewport`);
    const inner = yield* innerOf(attached, child, hit.backendNodeId);
    if (inner !== undefined) {
      const offset = yield* offsetOf(attached, inner);
      local = { x: at.x - offset.x, y: at.y - offset.y };
      child = inner;
      continue;
    }
    if (yield* joining(attached, child, hit.backendNodeId)) continue;
    const frame = hit.frameId ?? (child === undefined ? attached.main : attached.children.get(child));
    const anchor = frame === undefined ? undefined : anchorOf(attached, frame, hit.backendNodeId);
    const object = frame === undefined ? null : yield* resolvedIn(attached, child, frame, hit.backendNodeId);
    if (anchor === undefined || object === null) return yield* actionFailed(`the element at ${at.x}, ${at.y} is in a frame still loading`);
    return { ref: state.refs.issue(anchor), anchor, child, object };
  }
});

const OWNS = `function () { return this.ownerDocument === document || this === document; }`;

export const frameOfNode = Effect.fnUntraced(function* (
  attached: Attached,
  child: string | undefined,
  node: number,
): Effect.fn.Return<string | undefined, CommandFailure> {
  const candidates = [...attached.frames].filter(([, frame]) => frame.child === child).map(([id]) => id);
  if (candidates.length <= 1) return candidates[0];
  for (const frame of candidates) {
    const context = yield* world(attached, frame).pipe(Effect.catchTag('GateRefusal', () => Effect.succeed(null)));
    if (context === null) continue;
    const resolved = yield* attached.session
      .send('DOM.resolveNode', { backendNodeId: node, executionContextId: context, objectGroup: attached.group }, child)
      .pipe(Effect.catchTag('CommandRefused', () => Effect.succeed(null)));
    const objectId = resolved?.object.objectId;
    if (objectId === undefined) continue;
    const owns = yield* attached.session.send(
      'Runtime.callFunctionOn',
      { objectId, functionDeclaration: OWNS, returnByValue: true },
      child,
    );
    if (owns.result.value === true) return frame;
  }
  return undefined;
});
