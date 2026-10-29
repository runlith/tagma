import { ATTRIBUTES, type Described, DESCRIBE, HTML_LIMIT, redacted, STYLES, TEXT_LIMIT } from '@runlith/cdp/describe';
import { bytesOf, parsed } from '@runlith/cdp/payload';
import type { CommandFailure } from '@runlith/cdp/session';
import { type AxNode, type SnapshotPart, snapshotWalk } from '@runlith/cdp/snapshot';
import type { Protocol } from 'devtools-protocol';
import { Effect, type FileSystem, type Path } from 'effect';
import type { ServedRoots } from '../contract/service/sources.js';
import type { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import type { PageId } from '../contract/wire/ids.js';
import type { Picked } from '../contract/wire/pick.js';
import { unmarked } from './cursor.js';
import type { Attached, Frame, Paged, Picking } from './drive.js';
import { componentOf } from './source.js';
import { actionFailed, anchorOf, boxOf, joined, call, frameOfNode, locate, staleRef } from './target.js';

const FULL_PAGE_PX = 16_384;
const PICTURE_PX = 1_600;

export const snapshot = Effect.fnUntraced(function* (state: Paged, attached: Attached, within: string | undefined, limit: number) {
  const loaders = new Map<string, string>();
  const frames = new Map<string, Frame | undefined>(attached.frames);
  const children = new Map<string, string>();
  for (const [child, frame] of attached.children) {
    children.set(frame, child);
    if (!frames.has(frame)) frames.set(frame, undefined);
  }
  const ordered = [...frames]
    .filter(
      ([id, frame]) => id === attached.main || children.has(id) || (frame !== undefined && frame.url !== '' && frame.url !== 'about:blank'),
    )
    .sort(([left], [right]) => (left === attached.main ? -1 : right === attached.main ? 1 : 0));
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
    if (target !== undefined) yield* joined(attached, target);
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
    const adopted = [...attached.children].find(([, root]) => root === frameId)?.[0];
    return adopted === undefined ? null : yield* gone(rootOf(frameId, adopted), null);
  });
  const parts =
    target === null
      ? ordered.map(([frameId, frame], at) => {
          const child = children.get(frameId) ?? frame?.child;
          return partOf(
            frameId,
            child,
            child === undefined && at > 0
              ? rootOf(frameId, undefined).pipe(Effect.catchTag('CommandRefused', () => remoteRoot(frameId)))
              : gone(rootOf(frameId, child), null),
            at === 0 ? null : (frame?.url ?? ''),
          );
        })
      : [partOf(target.anchor.frame, target.child, Effect.succeed(start), null)];
  const shot = yield* snapshotWalk(
    parts.map((held) => held.part),
    limit,
  );
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

export const pngSize = (bytes: Uint8Array): { readonly width: number | null; readonly height: number | null } => {
  if (bytes.length < 24 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52)
    return { width: null, height: null };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const clipOf = Effect.fnUntraced(function* (
  attached: Attached,
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  ceiling: number,
) {
  const metrics = yield* attached.session.send('Page.getLayoutMetrics');
  return {
    x: box.x + metrics.cssVisualViewport.pageX,
    y: box.y + metrics.cssVisualViewport.pageY,
    width: Math.max(1, Math.min(box.width, ceiling)),
    height: Math.max(1, Math.min(box.height, ceiling)),
    scale: 1,
  } satisfies Protocol.Page.Viewport;
});

export const screenshot = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  kind: 'viewport' | 'full' | 'element',
  ref: string | undefined,
) {
  let params: Protocol.Page.CaptureScreenshotRequest = { format: 'png' };
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
    params = { format: 'png', clip: yield* clipOf(attached, yield* boxOf(attached, located), FULL_PAGE_PX) };
  }
  const bytes = yield* bytesOf(yield* unmarked(state, attached, attached.session.reply('Page.captureScreenshot', params)));
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
      : yield* unmarked(
          state,
          attached,
          attached.session.reply('Page.captureScreenshot', { format: 'png', clip: yield* clipOf(attached, box, PICTURE_PX) }),
        ).pipe(
          Effect.flatMap((text) => parsed(text)),
          Effect.map((reply) => (reply as { readonly result?: { readonly data?: string } }).result?.data ?? null),
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
