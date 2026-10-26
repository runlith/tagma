export type MessageNode =
  | { kind: 'text'; value: string }
  | { kind: 'arg'; name: string }
  | { kind: 'pound' }
  | { kind: 'branch'; name: string; type: BranchType; branches: MessageBranch[] };

export type BranchType = 'plural' | 'selectordinal' | 'select';

export type MessageBranch = {
  keyword?: string;
  exact?: number;
  nodes: MessageNode[];
};

export class MessageFormatError extends Error {}

const BRANCH_TYPES = new Set<string>(['plural', 'selectordinal', 'select']);
const SYNTAX_AFTER_APOSTROPHE = new Set(['{', '}', '#']);

type Cursor = { readonly text: string; index: number };

export function parseMessage(template: string): MessageNode[] {
  const cursor: Cursor = { text: template, index: 0 };
  const nodes = parseNodes(cursor, { stopAtBrace: false, inPlural: false });

  if (cursor.index < template.length) {
    throw new MessageFormatError(`Unexpected "}" at ${cursor.index}`);
  }

  return nodes;
}

function parseNodes(cursor: Cursor, options: { stopAtBrace: boolean; inPlural: boolean }): MessageNode[] {
  const nodes: MessageNode[] = [];
  let text = '';

  const flush = (): void => {
    if (text.length === 0) return;
    nodes.push({ kind: 'text', value: text });
    text = '';
  };

  while (cursor.index < cursor.text.length) {
    const char = cursor.text[cursor.index];

    if (char === '}') {
      if (!options.stopAtBrace) break;
      flush();
      return nodes;
    }

    if (char === '{') {
      flush();
      nodes.push(parseArgument(cursor));
      continue;
    }

    if (char === '#' && options.inPlural) {
      flush();
      nodes.push({ kind: 'pound' });
      cursor.index += 1;
      continue;
    }

    if (char === "'") {
      text += readApostrophe(cursor);
      continue;
    }

    text += char;
    cursor.index += 1;
  }

  if (options.stopAtBrace) {
    throw new MessageFormatError('Unterminated branch');
  }

  flush();
  return nodes;
}

function readApostrophe(cursor: Cursor): string {
  const next = cursor.text[cursor.index + 1];

  if (next === "'") {
    cursor.index += 2;
    return "'";
  }

  if (next === undefined || !SYNTAX_AFTER_APOSTROPHE.has(next)) {
    cursor.index += 1;
    return "'";
  }

  cursor.index += 1;
  let quoted = '';

  while (cursor.index < cursor.text.length) {
    const char = cursor.text[cursor.index];

    if (char === "'") {
      if (cursor.text[cursor.index + 1] === "'") {
        quoted += "'";
        cursor.index += 2;
        continue;
      }
      cursor.index += 1;
      return quoted;
    }

    quoted += char;
    cursor.index += 1;
  }

  return quoted;
}

function parseArgument(cursor: Cursor): MessageNode {
  cursor.index += 1;
  skipWhitespace(cursor);

  const name = readUntil(cursor, [',', '}']).trim();
  if (!name) {
    throw new MessageFormatError(`Empty argument name at ${cursor.index}`);
  }

  skipWhitespace(cursor);

  if (cursor.text[cursor.index] === '}') {
    cursor.index += 1;
    return { kind: 'arg', name };
  }

  if (cursor.text[cursor.index] !== ',') {
    throw new MessageFormatError(`Unterminated argument "${name}"`);
  }

  cursor.index += 1;
  skipWhitespace(cursor);

  const type = readUntil(cursor, [',', '}']).trim();
  if (!BRANCH_TYPES.has(type)) {
    throw new MessageFormatError(`Unsupported argument type "${type}" for "${name}"`);
  }

  if (cursor.text[cursor.index] !== ',') {
    throw new MessageFormatError(`Argument "${name}" has no branches`);
  }

  cursor.index += 1;

  const branches = parseBranches(cursor, type as BranchType);
  if (branches.length === 0) {
    throw new MessageFormatError(`Argument "${name}" has no branches`);
  }

  if (cursor.text[cursor.index] !== '}') {
    throw new MessageFormatError(`Unterminated argument "${name}"`);
  }
  cursor.index += 1;

  return { kind: 'branch', name, type: type as BranchType, branches };
}

function parseBranches(cursor: Cursor, type: BranchType): MessageBranch[] {
  const branches: MessageBranch[] = [];

  while (cursor.index < cursor.text.length) {
    skipWhitespace(cursor);
    if (cursor.text[cursor.index] === '}') break;

    const selector = readSelector(cursor);
    skipWhitespace(cursor);

    if (cursor.text[cursor.index] !== '{') {
      throw new MessageFormatError(`Branch "${selector}" has no body`);
    }
    cursor.index += 1;

    const nodes = parseNodes(cursor, { stopAtBrace: true, inPlural: type !== 'select' });
    cursor.index += 1;

    if (selector.startsWith('=')) {
      const exact = Number(selector.slice(1));
      if (!Number.isFinite(exact)) {
        throw new MessageFormatError(`Invalid exact selector "${selector}"`);
      }
      branches.push({ exact, nodes });
      continue;
    }

    branches.push({ keyword: selector, nodes });
  }

  return branches;
}

function readSelector(cursor: Cursor): string {
  const start = cursor.index;

  while (cursor.index < cursor.text.length) {
    const char = cursor.text[cursor.index] ?? '';
    if (char === '{' || char === '}' || /\s/.test(char)) break;
    cursor.index += 1;
  }

  const selector = cursor.text.slice(start, cursor.index);
  if (!selector) {
    throw new MessageFormatError(`Empty branch selector at ${start}`);
  }

  return selector;
}

function readUntil(cursor: Cursor, stops: string[]): string {
  const start = cursor.index;

  while (cursor.index < cursor.text.length && !stops.includes(cursor.text[cursor.index] ?? '')) {
    cursor.index += 1;
  }

  return cursor.text.slice(start, cursor.index);
}

function skipWhitespace(cursor: Cursor): void {
  while (cursor.index < cursor.text.length && /\s/.test(cursor.text[cursor.index] ?? '')) {
    cursor.index += 1;
  }
}

export type RenderContext = {
  params: Record<string, unknown>;
  resolveMissing: (name: string) => string;
  selectPluralCategory: (value: number, type: 'cardinal' | 'ordinal') => string;
  formatNumber: (value: number) => string;
};

export function renderMessage(nodes: readonly MessageNode[], context: RenderContext): string {
  return render(nodes, context, undefined);
}

function render(nodes: readonly MessageNode[], context: RenderContext, poundValue: number | undefined): string {
  let out = '';

  for (const node of nodes) {
    if (node.kind === 'text') {
      out += node.value;
      continue;
    }

    if (node.kind === 'pound') {
      out += poundValue === undefined ? '#' : context.formatNumber(poundValue);
      continue;
    }

    if (node.kind === 'arg') {
      const value = context.params[node.name];
      out += value === undefined ? context.resolveMissing(node.name) : String(value);
      continue;
    }

    out += renderBranch(node, context);
  }

  return out;
}

function renderBranch(node: Extract<MessageNode, { kind: 'branch' }>, context: RenderContext): string {
  const value = context.params[node.name];

  if (node.type === 'select') {
    const branch = pickByKeyword(node.branches, String(value ?? ''));
    return render(branch.nodes, context, undefined);
  }

  const numeric = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return render(pickByKeyword(node.branches, 'other').nodes, context, undefined);
  }

  const exact = node.branches.find((branch) => branch.exact === numeric);
  if (exact) return render(exact.nodes, context, numeric);

  const category = context.selectPluralCategory(numeric, node.type === 'selectordinal' ? 'ordinal' : 'cardinal');
  return render(pickByKeyword(node.branches, category).nodes, context, numeric);
}

function pickByKeyword(branches: readonly MessageBranch[], keyword: string): MessageBranch {
  const picked =
    branches.find((branch) => branch.keyword === keyword) ?? branches.find((branch) => branch.keyword === 'other') ?? branches[0];
  if (!picked) throw new MessageFormatError('A branching node with no branch');
  return picked;
}
