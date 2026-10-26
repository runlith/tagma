import { shareText, sliceText, type TextSlice } from './text.js';

export type Writer = { readonly row: string; readonly holder: string };
export type Mark = Writer | 'external';
export type Point = { readonly source: Source; readonly offset: number };

export type TextLines = {
  readonly text: string;
  readonly lines: readonly string[];
  readonly offsets: ArrayLike<number>;
  readonly shared: TextSlice;
};

export type Source = TextLines & {
  readonly serial: number;
  readonly mark: Mark | 'base';
  readonly removed: Rope;
  readonly origins: Rope;
  readonly displaced: readonly Source[];
  readonly inherited: readonly Source[];
  readonly left: Point | null;
  readonly right: Point | null;
};

export type Run = {
  readonly source: Source;
  readonly offset: number;
  readonly count: number;
  readonly raw?: TextLines;
  readonly rawOrigin?: number;
};
export type Rope = Leaf | Branch | null;
type Extent = { readonly low: number; readonly high: number };
type Leaf = Extent & { readonly kind: 'leaf'; readonly run: Run; readonly count: number; readonly height: 1 };
type Branch = Extent & {
  readonly kind: 'branch';
  readonly left: Rope;
  readonly right: Rope;
  readonly count: number;
  readonly height: number;
};

export const sizeOf = (rope: Rope): number => rope?.count ?? 0;
const heightOf = (rope: Rope): number => rope?.height ?? 0;

export function leaf(run: Run): Rope {
  return run.count === 0 ? null : { kind: 'leaf', run, count: run.count, height: 1, low: run.source.serial, high: run.source.serial };
}

function branch(left: Rope, right: Rope): Rope {
  if (left === null) return right;
  if (right === null) return left;
  return {
    kind: 'branch',
    left,
    right,
    count: left.count + right.count,
    height: Math.max(left.height, right.height) + 1,
    low: Math.min(left.low, right.low),
    high: Math.max(left.high, right.high),
  };
}

function balanced(left: Rope, right: Rope): Rope {
  if (heightOf(left) > heightOf(right) + 1 && left?.kind === 'branch') {
    if (heightOf(left.left) >= heightOf(left.right)) return branch(left.left, branch(left.right, right));
    if (left.right?.kind === 'branch') return branch(branch(left.left, left.right.left), branch(left.right.right, right));
  }
  if (heightOf(right) > heightOf(left) + 1 && right?.kind === 'branch') {
    if (heightOf(right.right) >= heightOf(right.left)) return branch(branch(left, right.left), right.right);
    if (right.left?.kind === 'branch') return branch(branch(left, right.left.left), branch(right.left.right, right.right));
  }
  return branch(left, right);
}

export function joined(left: Rope, right: Rope): Rope {
  if (left === null) return right;
  if (right === null) return left;
  if (
    left.kind === 'leaf' &&
    right.kind === 'leaf' &&
    left.run.source === right.run.source &&
    left.run.raw === right.run.raw &&
    left.run.rawOrigin === right.run.rawOrigin &&
    left.run.offset + left.count === right.run.offset
  ) {
    return leaf({ ...left.run, count: left.count + right.count });
  }
  if (left.height > right.height + 1 && left.kind === 'branch') return balanced(left.left, joined(left.right, right));
  if (right.height > left.height + 1 && right.kind === 'branch') return balanced(joined(left, right.left), right.right);
  return branch(left, right);
}

export function split(rope: Rope, at: number): readonly [Rope, Rope] {
  if (rope === null) return [null, null];
  if (at <= 0) return [null, rope];
  if (at >= rope.count) return [rope, null];
  if (rope.kind === 'leaf')
    return [leaf({ ...rope.run, count: at }), leaf({ ...rope.run, offset: rope.run.offset + at, count: rope.count - at })];
  const leftCount = sizeOf(rope.left);
  if (at < leftCount) {
    const [before, after] = split(rope.left, at);
    return [before, joined(after, rope.right)];
  }
  const [before, after] = split(rope.right, at - leftCount);
  return [joined(rope.left, before), after];
}

export function sliced(rope: Rope, start: number, count: number): Rope {
  return split(split(rope, start)[1], count)[0];
}

export function spliced(rope: Rope, start: number, count: number, insert: Rope): Rope {
  const [before, rest] = split(rope, start);
  return joined(joined(before, insert), split(rest, count)[1]);
}

export function pointAt(rope: Rope, at: number): Point | null {
  if (rope === null || at < 0 || at >= rope.count) return null;
  if (rope.kind === 'leaf') return { source: rope.run.source, offset: rope.run.offset + at };
  const leftCount = sizeOf(rope.left);
  return at < leftCount ? pointAt(rope.left, at) : pointAt(rope.right, at - leftCount);
}

export function* runsOf(rope: Rope): Generator<Run> {
  if (rope === null) return;
  if (rope.kind === 'leaf') yield rope.run;
  else {
    yield* runsOf(rope.left);
    yield* runsOf(rope.right);
  }
}

export function* pointsOf(rope: Rope): Generator<Point> {
  for (const run of runsOf(rope)) for (let at = 0; at < run.count; at += 1) yield { source: run.source, offset: run.offset + at };
}

export const textAt = (point: Point): string => point.source.lines[point.offset] as string;
export function runText(run: Run): string {
  const buffer = run.raw ?? run.source;
  const offset = run.offset - (run.rawOrigin ?? 0);
  return buffer.text.slice(buffer.offsets[offset], buffer.offsets[offset + run.count]);
}
export const textOf = (rope: Rope): string => [...runsOf(rope)].map(runText).join('');
export const sharedRuns = (rope: Rope): readonly TextSlice[] =>
  [...runsOf(rope)].map((run) => {
    const buffer = run.raw ?? run.source;
    const offset = run.offset - (run.rawOrigin ?? 0);
    return sliceText(buffer.shared, offset, offset + run.count);
  });

export function withBytes(rope: Rope, lines: readonly string[]): Rope {
  let at = 0;
  let result: Rope = null;
  for (const run of runsOf(rope)) {
    const buffer = run.raw ?? run.source;
    const offset = run.offset - (run.rawOrigin ?? 0);
    const same = lines.slice(at, at + run.count).every((line, i) => line === buffer.lines[offset + i]);
    result = joined(result, leaf(same ? run : { ...run, raw: bufferOf(lines.slice(at, at + run.count)), rawOrigin: run.offset }));
    at += run.count;
  }
  return result;
}

export function bufferOf(lines: readonly string[], text = lines.join('')): TextLines {
  const offsets = [0];
  for (const line of lines) offsets.push((offsets[offsets.length - 1] as number) + line.length);
  return { text, lines, offsets, shared: shareText(text, offsets) };
}

export function sourceSpans(rope: Rope, source: Source, start = 0): readonly { readonly at: number; readonly run: Run }[] {
  if (rope === null || source.serial < rope.low || source.serial > rope.high) return [];
  if (rope.kind === 'leaf') return rope.run.source === source ? [{ at: start, run: rope.run }] : [];
  return [...sourceSpans(rope.left, source, start), ...sourceSpans(rope.right, source, start + sizeOf(rope.left))];
}

export function positionOf(rope: Rope, point: Point, start = 0): number | undefined {
  if (rope === null || point.source.serial < rope.low || point.source.serial > rope.high) return undefined;
  if (rope.kind === 'leaf')
    return rope.run.source === point.source && point.offset >= rope.run.offset && point.offset < rope.run.offset + rope.count
      ? start + point.offset - rope.run.offset
      : undefined;
  return positionOf(rope.left, point, start) ?? positionOf(rope.right, point, start + sizeOf(rope.left));
}

export type LocatedRun = Run & { readonly at: number };
export function locatedRuns(rope: Rope): readonly LocatedRun[] {
  let at = 0;
  return [...runsOf(rope)].map((run) => {
    const located = { ...run, at };
    at += run.count;
    return located;
  });
}

export function runAt<A extends { readonly at: number; readonly count: number }>(runs: readonly A[], at: number): A | undefined {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((runs[mid] as A).at <= at) low = mid + 1;
    else high = mid;
  }
  const run = runs[low - 1];
  return run !== undefined && at < run.at + run.count ? run : undefined;
}
export const samePoint = (one: Point | null, two: Point | null): boolean =>
  one === null || two === null ? one === two : one.source === two.source && one.offset === two.offset;
export const tokensOf = (text: string | null): readonly string[] =>
  text === null || text === '' ? [] : (text.match(/[^\n]*\n|[^\n]+$/g) ?? []);
export function lineCount(text: string): number {
  let count = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1;
  return text === '' || text.endsWith('\n') ? count : count + 1;
}
export const keyOf = (text: string, normalized: boolean): string => (normalized ? text.replaceAll('\r\n', '\n') : text);

export type KeyTree<A> = {
  readonly key: string;
  readonly value: A;
  readonly left: KeyTree<A>;
  readonly right: KeyTree<A>;
  readonly height: number;
} | null;
const keyHeight = <A>(tree: KeyTree<A>): number => tree?.height ?? 0;
const keyNode = <A>(key: string, value: A, left: KeyTree<A>, right: KeyTree<A>): KeyTree<A> => ({
  key,
  value,
  left,
  right,
  height: 1 + Math.max(keyHeight(left), keyHeight(right)),
});

function keyBalance<A>(key: string, value: A, left: KeyTree<A>, right: KeyTree<A>): KeyTree<A> {
  if (left !== null && keyHeight(left) > keyHeight(right) + 1) {
    const middle = left.right;
    if (keyHeight(left.left) >= keyHeight(middle) || middle === null)
      return keyNode(left.key, left.value, left.left, keyNode(key, value, middle, right));
    return keyNode(
      middle.key,
      middle.value,
      keyNode(left.key, left.value, left.left, middle.left),
      keyNode(key, value, middle.right, right),
    );
  }
  if (right !== null && keyHeight(right) > keyHeight(left) + 1) {
    const middle = right.left;
    if (keyHeight(right.right) >= keyHeight(middle) || middle === null)
      return keyNode(right.key, right.value, keyNode(key, value, left, middle), right.right);
    return keyNode(
      middle.key,
      middle.value,
      keyNode(key, value, left, middle.left),
      keyNode(right.key, right.value, middle.right, right.right),
    );
  }
  return keyNode(key, value, left, right);
}

export function lookup<A>(tree: KeyTree<A>, key: string): A | undefined {
  while (tree !== null) {
    if (key === tree.key) return tree.value;
    tree = key < tree.key ? tree.left : tree.right;
  }
  return undefined;
}

export function put<A>(tree: KeyTree<A>, key: string, value: A): KeyTree<A> {
  if (tree === null) return keyNode(key, value, null, null);
  if (key === tree.key) return { ...tree, value };
  return key < tree.key
    ? keyBalance(tree.key, tree.value, put(tree.left, key, value), tree.right)
    : keyBalance(tree.key, tree.value, tree.left, put(tree.right, key, value));
}

export function remove<A>(tree: KeyTree<A>, key: string): KeyTree<A> {
  if (tree === null) return null;
  if (key < tree.key) return keyBalance(tree.key, tree.value, remove(tree.left, key), tree.right);
  if (key > tree.key) return keyBalance(tree.key, tree.value, tree.left, remove(tree.right, key));
  if (tree.left === null) return tree.right;
  if (tree.right === null) return tree.left;
  let next = tree.right;
  while (next.left !== null) next = next.left;
  return keyBalance(next.key, next.value, tree.left, remove(tree.right, next.key));
}

export function* valuesOf<A>(tree: KeyTree<A>): Generator<A> {
  if (tree === null) return;
  yield* valuesOf(tree.left);
  yield tree.value;
  yield* valuesOf(tree.right);
}
