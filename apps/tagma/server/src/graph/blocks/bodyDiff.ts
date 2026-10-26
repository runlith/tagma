import type { BodyDelta, BodySpan } from '../contract/wire/journalPayloads.js';

const DIFF_WORK = 1 << 21;
const DIRECT_WORK = 1 << 19;
const REFINE_WORK = 1 << 16;

type Budget = { left: number };
type Hunk = { a0: number; a1: number; b0: number; b1: number };

export function bodyDelta(before: string, after: string): BodyDelta {
  const budget: Budget = { left: DIFF_WORK };
  const beforeLines = linesOf(before);
  const afterLines = linesOf(after);
  const beforeAt = offsetsOf(beforeLines);
  const afterAt = offsetsOf(afterLines);
  const spans: BodySpan[] = [];
  for (const lines of lineHunks(...identities(beforeLines, afterLines), budget)) {
    const at = beforeAt[lines.a0] ?? 0;
    const del = before.slice(at, beforeAt[lines.a1]);
    const ins = after.slice(afterAt[lines.b0], afterAt[lines.b1]);
    if (del.length === 0 || ins.length === 0) {
      spans.push({ at, del, ins });
      continue;
    }
    const delWords = wordsOf(del);
    const insWords = wordsOf(ins);
    const delAt = offsetsOf(delWords);
    const insAt = offsetsOf(insWords);
    for (const words of withShare(budget, REFINE_WORK, (share) => hunks(...identities(delWords, insWords), share))) {
      spans.push({
        at: at + (delAt[words.a0] ?? 0),
        del: del.slice(delAt[words.a0], delAt[words.a1]),
        ins: ins.slice(insAt[words.b0], insAt[words.b1]),
      });
    }
  }
  return spans;
}

function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function wordsOf(text: string): string[] {
  return text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
}

function offsetsOf(lines: readonly string[]): number[] {
  const at = [0];
  for (const line of lines) at.push((at.at(-1) ?? 0) + line.length);
  return at;
}

function withShare<T>(budget: Budget, cap: number, work: (share: Budget) => T): T {
  const granted = Math.max(0, Math.min(budget.left, cap));
  const share: Budget = { left: granted };
  const done = work(share);
  budget.left -= granted - share.left;
  return done;
}

function identities(before: readonly string[], after: readonly string[]): [number[], number[]] {
  const ids = new Map<string, number>();
  const idsOf = (parts: readonly string[]): number[] =>
    parts.map((part) => {
      const known = ids.get(part);
      if (known !== undefined) return known;
      ids.set(part, ids.size);
      return ids.size - 1;
    });
  return [idsOf(before), idsOf(after)];
}

function lineHunks(a: readonly number[], b: readonly number[], budget: Budget): Hunk[] {
  const direct = withShare(budget, DIRECT_WORK, (share) => myers(a, b, share));
  if (direct !== null) return direct;
  const found: Hunk[] = [];
  let a0 = 0;
  let b0 = 0;
  for (const [a1, b1] of [...anchors(a, b), [a.length, b.length] as const]) {
    for (const gap of withShare(budget, REFINE_WORK, (share) => hunks(a.slice(a0, a1), b.slice(b0, b1), share))) {
      found.push({ a0: gap.a0 + a0, a1: gap.a1 + a0, b0: gap.b0 + b0, b1: gap.b1 + b0 });
    }
    a0 = a1 + 1;
    b0 = b1 + 1;
  }
  return found;
}

function anchors(a: readonly number[], b: readonly number[]): (readonly [number, number])[] {
  const seen = new Map<number, { inA: number; atA: number; inB: number; atB: number }>();
  a.forEach((id, at) => {
    const one = seen.get(id);
    if (one === undefined) seen.set(id, { inA: 1, atA: at, inB: 0, atB: -1 });
    else one.inA += 1;
  });
  b.forEach((id, at) => {
    const one = seen.get(id);
    if (one === undefined) return;
    one.inB += 1;
    one.atB = at;
  });
  const unique = [...seen.values()].filter((one) => one.inA === 1 && one.inB === 1);
  const tails: number[] = [];
  const previous = new Int32Array(unique.length).fill(-1);
  unique.forEach((one, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (unique[tails[middle]!]!.atB < one.atB) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  });
  const chain: (readonly [number, number])[] = [];
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]!) {
    const one = unique[index]!;
    chain.push([one.atA, one.atB]);
  }
  return chain.reverse();
}

function hunks(a: readonly number[], b: readonly number[], budget: Budget): Hunk[] {
  return myers(a, b, budget) ?? [trimmed(a, b)];
}

function trimmed(a: readonly number[], b: readonly number[]): Hunk {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  return { a0: head, a1: a.length - tail, b0: head, b1: b.length - tail };
}

function myers(a: readonly number[], b: readonly number[], budget: Budget): Hunk[] | null {
  const whole = trimmed(a, b);
  const head = whole.a0;
  const n = whole.a1 - head;
  const m = whole.b1 - head;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [whole];
  const reach = Math.min(n + m, Math.ceil(Math.sqrt(Math.max(budget.left, 0))) + 1);
  const offset = reach + 1;
  const v = new Int32Array(2 * reach + 3);
  const trace: Int32Array[] = [];
  let depth = -1;
  search: for (let d = 0; d <= reach; d += 1) {
    budget.left -= 2 * d + 3;
    if (budget.left < 0) return null;
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      const from = x;
      while (x < n && y < m && a[head + x] === b[head + y]) {
        x += 1;
        y += 1;
      }
      budget.left -= x - from;
      if (budget.left < 0) return null;
      v[offset + k] = x;
      if (x >= n && y >= m) {
        depth = d;
        break search;
      }
    }
  }
  if (depth < 0) return null;
  const found: Hunk[] = [];
  let open: Hunk | null = null;
  let x = n;
  let y = m;
  for (let d = depth; d > 0; d -= 1) {
    const before = trace[d]!;
    const at = (k: number): number => before[k + d + 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    const editX = down ? previousX : previousX + 1;
    if (x > editX && open !== null) {
      found.push(open);
      open = null;
    }
    if (open === null) open = { a0: previousX, a1: editX, b0: previousY, b1: editX - k };
    else {
      open.a0 = previousX;
      open.b0 = previousY;
    }
    x = previousX;
    y = previousY;
  }
  if (open !== null) found.push(open);
  return found.reverse().map((hunk) => ({
    a0: hunk.a0 + head,
    a1: hunk.a1 + head,
    b0: hunk.b0 + head,
    b1: hunk.b1 + head,
  }));
}

export function applyBodyDelta(before: string, delta: BodyDelta): string {
  let out = '';
  let cursor = 0;
  for (const span of delta) {
    out += before.slice(cursor, span.at) + span.ins;
    cursor = span.at + span.del.length;
  }
  return out + before.slice(cursor);
}

export function revertBodyDelta(after: string, delta: BodyDelta): string {
  let out = '';
  let cursor = 0;
  let shift = 0;
  for (const span of delta) {
    const at = span.at + shift;
    out += after.slice(cursor, at) + span.del;
    cursor = at + span.ins.length;
    shift += span.ins.length - span.del.length;
  }
  return out + after.slice(cursor);
}

export function mergedMarkdown(before: string, after: string): string {
  const budget: Budget = { left: DIFF_WORK };
  const groups = diffTokens(before.split('\n'), after.split('\n'), (a, b) => lineHunks(a, b, budget));
  const lines: string[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group) continue;
    if (group.kind === 'equal') {
      lines.push(...group.tokens);
      continue;
    }
    const next = groups[index + 1];
    if (group.kind === 'del' && next?.kind === 'ins') {
      const paired = Math.min(group.tokens.length, next.tokens.length);
      for (let at = 0; at < paired; at += 1) {
        lines.push(mergeLine(group.tokens[at] ?? '', next.tokens[at] ?? '', budget));
      }
      for (const line of group.tokens.slice(paired)) lines.push(markLine(line, 'del'));
      for (const line of next.tokens.slice(paired)) lines.push(markLine(line, 'ins'));
      index += 1;
      continue;
    }
    for (const line of group.tokens) lines.push(markLine(line, group.kind));
  }
  return plainInsideFences(lines).join('\n');
}

function mergeLine(before: string, after: string, budget: Budget): string {
  const prefix = markdownPrefix(after);
  const oldText = before.slice(markdownPrefix(before).length);
  const newText = after.slice(prefix.length);
  const groups = withShare(budget, REFINE_WORK, (share) => diffTokens(tokenize(oldText), tokenize(newText), (a, b) => hunks(a, b, share)));
  const words = (kind: TokenGroup['kind']) =>
    groups.filter((group) => group.kind === kind).reduce((count, group) => count + group.tokens.filter(isWord).length, 0);
  const gone = words('del');
  const came = words('ins');
  if (gone > 0 && came > 0 && words('equal') < Math.max(gone, came)) {
    return prefix + mark(oldText, 'del') + mark(newText, 'ins');
  }
  return (
    prefix + groups.map((group) => (group.kind === 'equal' ? group.tokens.join('') : mark(group.tokens.join(''), group.kind))).join('')
  );
}

function isWord(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

function markLine(line: string, kind: 'ins' | 'del'): string {
  const prefix = markdownPrefix(line);
  return prefix + mark(line.slice(prefix.length), kind);
}

function mark(text: string, kind: 'ins' | 'del'): string {
  return text.trim().length === 0 ? text : `<${kind}>${text}</${kind}>`;
}

function markdownPrefix(line: string): string {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)?/.exec(line)?.[0] ?? '';
}

function plainInsideFences(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const opensFence = /^\s*(?:```|~~~)/.test(unmark(line));
    if (!inside && !opensFence) {
      out.push(line);
      continue;
    }
    const now = unmark(line);
    if (opensFence) {
      out.push(now);
      inside = !inside;
      continue;
    }
    if (now.trim().length > 0 || !/<del>/.test(line)) out.push(now);
  }
  return out;
}

function unmark(line: string): string {
  return line.replaceAll(/<del>[\s\S]*?<\/del>/g, '').replaceAll(/<\/?ins>/g, '');
}

function tokenize(text: string): string[] {
  return text.match(/`[^`\n]*`|\[\[L-\d+(?:\|[^\]\n]+)?\]\]|\p{L}[\p{L}\p{N}_'-]*|\p{N}+|\s+|[^\s]/gu) ?? [];
}

type TokenGroup = { readonly kind: 'equal' | 'ins' | 'del'; readonly tokens: string[] };

function diffTokens(
  before: readonly string[],
  after: readonly string[],
  find: (a: readonly number[], b: readonly number[]) => Hunk[],
): TokenGroup[] {
  const [a, b] = identities(before, after);
  const groups: TokenGroup[] = [];
  const push = (kind: TokenGroup['kind'], tokens: string[]) => {
    if (tokens.length > 0) groups.push({ kind, tokens });
  };
  let cursor = 0;
  for (const hunk of find(a, b)) {
    push('equal', before.slice(cursor, hunk.a0));
    push('del', before.slice(hunk.a0, hunk.a1));
    push('ins', after.slice(hunk.b0, hunk.b1));
    cursor = hunk.a1;
  }
  push('equal', before.slice(cursor));
  return groups;
}
