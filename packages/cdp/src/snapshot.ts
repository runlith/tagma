import { Effect, Fiber } from 'effect';

export type Snapshot = {
  readonly lines: readonly string[];
  readonly nodes: readonly number[];
  readonly frames: readonly number[];
  readonly more: boolean;
};

type AxValue = { readonly value?: unknown };

export type AxNode = {
  readonly nodeId: string;
  readonly ignored?: boolean;
  readonly role?: AxValue;
  readonly name?: AxValue;
  readonly value?: AxValue;
  readonly properties?: readonly { readonly name: string; readonly value: AxValue }[];
  readonly childIds?: readonly string[];
  readonly backendDOMNodeId?: number;
  readonly parentId?: string;
};

const TRANSPARENT = new Set(['generic', 'none', 'presentation', 'LayoutTable', 'LayoutTableRow', 'LayoutTableCell', 'Unknown']);
const SKIPPED = new Set(['InlineTextBox', 'LineBreak']);
const VALUED = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'ProgressIndicator', 'progressbar']);
const FLAGS = ['disabled', 'focused', 'required', 'readonly', 'modal'] as const;
const TEXT_CHARS = 200;
const URL_CHARS = 120;

const said = (value: AxValue | undefined): string => {
  const held = value?.value;
  return typeof held === 'string'
    ? held
        .slice(0, TEXT_CHARS * 4)
        .replace(/\s+/g, ' ')
        .trim()
    : typeof held === 'number'
      ? String(held)
      : '';
};

const clipped = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit)}…` : text);

const marks = (node: AxNode, role: string): string => {
  let out = '';
  for (const property of node.properties ?? []) {
    const value = property.value?.value;
    switch (property.name) {
      case 'checked':
        if (value === 'true' || value === true) out += ' [checked]';
        else if (value === 'mixed') out += ' [checked=mixed]';
        break;
      case 'pressed':
        if (value === 'true' || value === true) out += ' [pressed]';
        else if (value === 'mixed') out += ' [pressed=mixed]';
        break;
      case 'expanded':
        out += value === true || value === 'true' ? ' [expanded]' : ' [collapsed]';
        break;
      case 'selected':
        if (value === true || value === 'true') out += ' [selected]';
        break;
      case 'level':
        if (typeof value === 'number') out += ` [level=${value}]`;
        break;
      case 'url':
        if (role === 'link' && typeof value === 'string' && value.length > 0) out += ` [url=${clipped(value, URL_CHARS)}]`;
        break;
      default:
        if ((FLAGS as readonly string[]).includes(property.name) && (value === true || value === 'true')) out += ` [${property.name}]`;
    }
  }
  if (VALUED.has(role)) {
    const value = said(node.value);
    if (value.length > 0) out += ` value=${JSON.stringify(clipped(value, TEXT_CHARS))}`;
  }
  return out;
};

export type SnapshotPart<E> = {
  readonly root: Effect.Effect<AxNode | null, E>;
  readonly children: (node: AxNode) => Effect.Effect<readonly AxNode[], E>;
  readonly header: string | null;
  readonly renderRoot: boolean;
};

const LEAVES = new Set(['StaticText', ...SKIPPED]);

const AHEAD = 8;

const parent = (node: AxNode): boolean => !LEAVES.has(said(node.role)) && (node.childIds ?? []).length > 0;

export const snapshotWalk = <E>(parts: Iterable<SnapshotPart<E>>, limit: number): Effect.Effect<Snapshot, E> =>
  Effect.scoped(walked(parts, limit));

const walked = Effect.fnUntraced(function* <E>(parts: Iterable<SnapshotPart<E>>, limit: number) {
  const scope = yield* Effect.scope;
  const lines: string[] = [];
  const nodes: number[] = [];
  const frames: number[] = [];
  let more = false;
  const emit = (line: string, node: number, frame: number): boolean => {
    if (lines.length >= limit) {
      more = true;
      return false;
    }
    lines.push(line);
    nodes.push(node);
    frames.push(frame);
    return true;
  };
  let frame = -1;
  for (const part of parts) {
    if (lines.length >= limit) {
      more = true;
      break;
    }
    frame += 1;
    const root = yield* part.root;
    if (root === null) continue;
    let depth = 0;
    if (part.header !== null) {
      if (!emit(`- frame ${JSON.stringify(clipped(part.header, URL_CHARS))}`, -1, frame)) break;
      depth = 1;
    }
    const stack: { readonly node: AxNode; readonly depth: number; readonly label: string; readonly render: boolean }[] = [
      { node: root, depth, label: '', render: part.renderRoot },
    ];
    const ahead = new Map<string, Fiber.Fiber<readonly AxNode[], E>>();
    const prefetch = Effect.fnUntraced(function* () {
      for (let at = stack.length - 1; at >= Math.max(0, stack.length - AHEAD) && ahead.size < AHEAD; at -= 1) {
        const node = stack[at]!.node;
        if (parent(node) && !ahead.has(node.nodeId)) ahead.set(node.nodeId, yield* Effect.forkIn(part.children(node), scope));
      }
    });
    while (stack.length > 0 && !more) {
      const { node, depth: at, label, render: shown } = stack.pop()!;
      const role = said(node.role);
      let childDepth = at;
      let childLabel = label;
      if (shown && !SKIPPED.has(role)) {
        const name = clipped(said(node.name), TEXT_CHARS);
        const transparent = node.ignored === true || (TRANSPARENT.has(role) && name.length === 0) || role === '';
        if (role === 'StaticText') {
          if (name.length > 0 && !label.includes(name) && !emit(`${'  '.repeat(at)}- text ${JSON.stringify(name)}`, -1, frame)) break;
        } else if (!transparent) {
          const named = name.length > 0 ? ` ${JSON.stringify(name)}` : '';
          if (!emit(`${'  '.repeat(at)}- ${role}${named}${marks(node, role)}`, node.backendDOMNodeId ?? -1, frame)) break;
          childDepth = at + 1;
          childLabel = name;
        }
      }
      if (!parent(node)) continue;
      const pending = ahead.get(node.nodeId);
      ahead.delete(node.nodeId);
      const fetched = new Map(
        (yield* pending === undefined ? part.children(node) : Fiber.join(pending)).map((child) => [child.nodeId, child]),
      );
      const order = node.childIds ?? [];
      for (let index = order.length - 1; index >= 0; index -= 1) {
        const child = fetched.get(order[index]!);
        if (child !== undefined) stack.push({ node: child, depth: childDepth, label: childLabel, render: true });
      }
      yield* prefetch();
    }
    if (more) break;
  }
  return { lines, nodes, frames, more } satisfies Snapshot;
});
