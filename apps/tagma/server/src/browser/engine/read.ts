import { ATTRIBUTES, type Described, DESCRIBE, HTML_LIMIT, redacted, STYLES, TEXT_LIMIT } from '@runlith/cdp/describe';
import { bytesOf } from '@runlith/cdp/payload';
import type { CommandFailure } from '@runlith/cdp/session';
import { type AxNode, type SnapshotPart, snapshotWalk } from '@runlith/cdp/snapshot';
import type { Protocol } from 'devtools-protocol';
import { Effect, type FileSystem, type Path } from 'effect';
import type { ServedRoots } from '../contract/service/sources.js';
import type { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import type { PageId } from '../contract/wire/ids.js';
import type { Picked } from '../contract/wire/pick.js';
import { unmarked } from './cursor.js';
import type { Attached, Paged, Picking } from './drive.js';
import { componentOf } from './source.js';
import { crop, pngSize } from './pictures.js';
import { actionFailed, anchorOf, type Box, boxOf, joined, call, frameOfNode, locate, staleRef, world } from './target.js';

const FULL_PAGE_PX = 16_384;
const PICTURE_PX = 1_600;

export const snapshot = Effect.fnUntraced(function* (state: Paged, attached: Attached, within: string | undefined, limit: number) {
  const loaders = new Map<string, string>();
  const target = within === undefined ? null : yield* locate(state, attached, within);
  const gone = <A>(effect: Effect.Effect<A, CommandFailure>, empty: A): Effect.Effect<A, CommandFailure> =>
    effect.pipe(
      Effect.catchTag('CommandRefused', () => Effect.succeed(empty)),
      Effect.catchIf(
        (failure) => failure._tag === 'SessionEnded' && failure.child !== undefined,
        () => Effect.succeed(empty),
      ),
    );
  const partOf = (
    frameId: string,
    child: string | undefined,
    root: Effect.Effect<AxNode | null, CommandFailure>,
    header: string | null,
  ) => ({
    frameId,
    part: {
      root: Effect.tap(root, () =>
        Effect.sync(() => {
          const loader = attached.frames.get(frameId)?.loader;
          if (loader !== undefined) loaders.set(frameId, loader);
        }),
      ),
      get header() {
        return header === null ? null : (attached.frames.get(frameId)?.url ?? header);
      },
      renderRoot: target !== null,
      children: (node: AxNode) =>
        gone(
          Effect.map(
            attached.session.send(
              'Accessibility.getChildAXNodes',
              { id: node.nodeId, frameId },
              attached.frames.get(frameId)?.child ?? child,
            ),
            (reply): readonly AxNode[] => reply.nodes,
          ),
          [] as readonly AxNode[],
        ),
    } satisfies SnapshotPart<CommandFailure>,
  });
  const start =
    target === null
      ? null
      : yield* gone(
          Effect.map(
            attached.session.send(
              'Accessibility.getPartialAXTree',
              { backendNodeId: target.anchor.node, fetchRelatives: false },
              target.child,
            ),
            ({ nodes }): AxNode | null => nodes.find((node) => node.backendDOMNodeId === target.anchor.node) ?? null,
          ),
          null,
        );
  if (target !== null && start === null) return yield* staleRef(within ?? '');
  const rootOf = Effect.fnUntraced(function* (frameId: string, child: string | undefined) {
    const target = child === undefined ? undefined : attached.children.get(child);
    if (target !== undefined) yield* joined(attached, target, child);
    const { node } = yield* attached.session.send('Accessibility.getRootAXNode', { frameId }, child);
    return node;
  });
  const remoteRoot = Effect.fnUntraced(function* (frameId: string) {
    const remote = yield* gone(
      Effect.map(attached.session.send('Target.getTargetInfo', { targetId: frameId }), ({ targetInfo }) => targetInfo.type === 'iframe'),
      false,
    );
    if (!remote) return null;
    yield* joined(attached, frameId);
    const adopted = attached.sessions.get(frameId);
    return adopted === undefined ? null : yield* gone(rootOf(frameId, adopted), null);
  });
  const parts: ReturnType<typeof partOf>[] = [];
  function* candidates(): Generator<readonly [string, string | undefined]> {
    yield [attached.main, undefined];
    yield* attached.sessions;
    for (const [id, frame] of attached.frames) {
      if (frame.url !== '' && frame.url !== 'about:blank') yield [id, frame.child];
    }
  }
  function* walking(): Generator<SnapshotPart<CommandFailure>> {
    if (target !== null) {
      const held = partOf(target.anchor.frame, target.child, Effect.succeed(start), null);
      parts.push(held);
      yield held.part;
      return;
    }
    const seen = new Set<string>();
    for (const [frameId, child] of candidates()) {
      if (seen.has(frameId)) continue;
      seen.add(frameId);
      const main = frameId === attached.main;
      const held = partOf(
        frameId,
        child,
        child === undefined && !main
          ? rootOf(frameId, undefined).pipe(Effect.catchTag('CommandRefused', () => remoteRoot(frameId)))
          : gone(rootOf(frameId, child), null),
        main ? null : (attached.frames.get(frameId)?.url ?? ''),
      );
      parts.push(held);
      yield held.part;
    }
  }
  const shot = yield* snapshotWalk(walking(), limit);
  const lines = shot.lines.map((line, at) => {
    const node = shot.nodes[at]!;
    if (node < 0) return line;
    const frameId = parts[shot.frames[at]!]!.frameId;
    const anchor = anchorOf(attached, frameId, node);
    return anchor === undefined || anchor.loader !== loaders.get(frameId) ? line : `${line} [ref=${state.refs.issue(anchor)}]`;
  });
  return { text: lines.join('\n'), shown: lines.length, more: shot.more };
});

export type Shot = { readonly bytes: Uint8Array; readonly width: number | null; readonly height: number | null };

const captured = (attached: Attached, params: Protocol.Page.CaptureScreenshotRequest) =>
  attached.pictures.capture(params).pipe(Effect.flatMap(bytesOf));

type View = Box & { readonly pageX: number; readonly pageY: number; readonly scale: number };

const elementPicture = Effect.fnUntraced(function* (attached: Attached, box: Box, ceiling: number) {
  const viewport = (yield* attached.session.send('Runtime.evaluate', {
    expression:
      '({ x: visualViewport.offsetLeft, y: visualViewport.offsetTop, width: visualViewport.width, height: visualViewport.height, pageX: scrollX, pageY: scrollY, scale: devicePixelRatio * visualViewport.scale })',
    contextId: yield* world(attached, attached.main),
    returnByValue: true,
  })).result.value as View;
  const region = { ...box, width: Math.max(1, Math.min(box.width, ceiling)), height: Math.max(1, Math.min(box.height, ceiling)) };
  const visible = { ...region, x: region.x - viewport.x, y: region.y - viewport.y };
  if (visible.x >= 0 && visible.y >= 0 && visible.x + visible.width <= viewport.width && visible.y + visible.height <= viewport.height) {
    return yield* crop(yield* captured(attached, { format: 'png' }), visible, viewport.scale);
  }
  return yield* captured(attached, {
    format: 'png',
    clip: { x: region.x + viewport.pageX, y: region.y + viewport.pageY, width: region.width, height: region.height, scale: 1 },
  });
});

export const screenshot = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  kind: 'viewport' | 'full' | 'element',
  ref: string | undefined,
) {
  let params: Protocol.Page.CaptureScreenshotRequest = { format: 'png' };
  let element: Box | null = null;
  if (kind === 'full') {
    const metrics = yield* attached.session.send('Page.getLayoutMetrics');
    params = {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: Math.min(metrics.cssContentSize.width, FULL_PAGE_PX),
        height: Math.min(metrics.cssContentSize.height, FULL_PAGE_PX),
        scale: 1,
      },
    };
  } else if (kind === 'element') {
    if (ref === undefined) return yield* actionFailed('an element capture names the `ref` of the element');
    const located = yield* locate(state, attached, ref);
    element = yield* boxOf(attached, located);
  }
  const bytes = yield* unmarked(
    state,
    attached,
    element === null ? captured(attached, params) : elementPicture(attached, element, FULL_PAGE_PX),
  );
  return { bytes, ...pngSize(bytes) } satisfies Shot;
});

export const describePick = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  page: PageId,
  url: string,
  picking: Picking,
  projectId: number,
): Effect.fn.Return<
  Picked | null,
  CommandFailure | ReturnType<typeof actionFailed> | ReturnType<typeof staleRef>,
  FileSystem.FileSystem | CheckoutPaths | ServedRoots | Path.Path
> {
  const frame = yield* frameOfNode(attached, picking.child, picking.node);
  const anchor = frame === undefined ? undefined : anchorOf(attached, frame, picking.node);
  if (anchor === undefined) return null;
  const ref = state.refs.issue(anchor);
  const located = yield* locate(state, attached, ref);
  const described = redacted(yield* call<Described>(attached, located, DESCRIBE, [ATTRIBUTES, STYLES, TEXT_LIMIT, HTML_LIMIT]));
  const component = yield* componentOf(attached, located, projectId, attached.frames.get(anchor.frame)?.url ?? url).pipe(
    Effect.catchTags({
      PlatformError: (failure) => actionFailed(`the picked source path could not be checked: ${failure.message}`),
      PlaceUnread: (failure) => actionFailed(`the picked source checkout could not be read: ${failure.reason}`),
      ServingUnread: (failure) => actionFailed(`the page's serving root could not be read: ${failure.message}`),
    }),
  );
  const nodes = yield* attached.session
    .send('Accessibility.getPartialAXTree', { backendNodeId: picking.node, fetchRelatives: false }, picking.child)
    .pipe(
      Effect.map((reply) => reply.nodes),
      Effect.catchTag('CommandRefused', () => Effect.succeed([] as readonly Protocol.Accessibility.AXNode[])),
    );
  const node = nodes.find((held) => held.backendDOMNodeId === picking.node) ?? nodes[0];
  const box = yield* boxOf(attached, located).pipe(Effect.catchTag('GateRefusal', () => Effect.succeed(null)));
  const picture =
    box === null
      ? null
      : yield* unmarked(state, attached, elementPicture(attached, box, PICTURE_PX)).pipe(
          Effect.map((bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')),
          Effect.catchTag('CommandRefused', () => Effect.succeed(null)),
        );
  return {
    page,
    url,
    ref,
    role: typeof node?.role?.value === 'string' ? node.role.value : '',
    name: typeof node?.name?.value === 'string' ? node.name.value : '',
    tag: described.tag,
    selector: described.selector,
    text: described.text,
    html: described.html,
    attributes: described.attributes,
    styles: described.styles,
    component,
    rect: box === null ? described.rect : { x: box.x, y: box.y, width: box.width, height: box.height },
    picture,
  };
});
