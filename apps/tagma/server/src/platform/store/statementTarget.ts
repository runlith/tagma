export type StatementWrite = {
  readonly kind: 'write';
  readonly verb: Verb;
  readonly table: string;
  readonly columns: ReadonlySet<string> | 'all';
  readonly replacing: boolean;
  readonly updating?: boolean;
  readonly conflict?: ConflictPolicy;
};

export type ConflictPolicy = 'rollback' | 'abort' | 'fail' | 'ignore' | 'replace';

export type StatementTarget = { readonly kind: 'other'; readonly temporary?: true } | StatementWrite | { readonly kind: 'unresolved' };

type Token =
  | { readonly word: string; readonly quoted: boolean; readonly start: number; readonly end: number }
  | { readonly mark: string; readonly start: number; readonly end: number };

const OTHER: StatementTarget = { kind: 'other' };
const UNRESOLVED: StatementTarget = { kind: 'unresolved' };
const CLOSERS: Record<string, string> = { '"': '"', '`': '`', '[': ']' };
const ENDS = new Set(['where', 'returning', 'from', 'order', 'limit', 'on']);

const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;

const closing = (sql: string, from: number, close: string): number => {
  let end = from;
  for (;;) {
    end = sql.indexOf(close, end);
    if (end === -1) return sql.length;
    if (close !== ']' && sql[end + 1] === close) end += 2;
    else return end;
  }
};

const wordEnd = (sql: string, at: number): number => {
  WORD.lastIndex = at;
  return WORD.test(sql) ? WORD.lastIndex : -1;
};

export const tokenize = (sql: string): Token[] => {
  const tokens: Token[] = [];
  let at = 0;
  while (at < sql.length) {
    const char = sql[at]!;
    const word = wordEnd(sql, at);
    if (/\s/.test(char)) at += 1;
    else if (sql.startsWith('--', at)) {
      const line = sql.indexOf('\n', at);
      at = line === -1 ? sql.length : line + 1;
    } else if (sql.startsWith('/*', at)) {
      const end = sql.indexOf('*/', at + 2);
      at = end === -1 ? sql.length : end + 2;
    } else if (char === "'" || CLOSERS[char] !== undefined) {
      const close = char === "'" ? "'" : CLOSERS[char]!;
      const end = closing(sql, at + 1, close);
      const past = end >= sql.length ? sql.length : end + 1;
      tokens.push(
        char === "'"
          ? { mark: "'", start: at, end: past }
          : {
              word: close === ']' ? sql.slice(at + 1, end) : sql.slice(at + 1, end).replaceAll(close + close, close),
              quoted: true,
              start: at,
              end: past,
            },
      );
      at = end + 1;
    } else if (word !== -1) {
      tokens.push({ word: sql.slice(at, word), quoted: false, start: at, end: word });
      at = word;
    } else {
      tokens.push({ mark: char, start: at, end: at + 1 });
      at += 1;
    }
  }
  return tokens;
};

export const isKeyword = (token: Token | undefined, word: string): boolean =>
  token !== undefined && 'word' in token && !token.quoted && token.word.toLowerCase() === word;

export const isMark = (token: Token | undefined, mark: string): boolean => token !== undefined && 'mark' in token && token.mark === mark;

export const nameOf = (token: Token | undefined): string | null => (token !== undefined && 'word' in token ? token.word : null);

export const pastGroup = (tokens: Token[], at: number): number => {
  let depth = 0;
  for (let index = at; index < tokens.length; index += 1) {
    if (isMark(tokens[index], '(')) depth += 1;
    else if (isMark(tokens[index], ')') && (depth -= 1) === 0) return index + 1;
  }
  return tokens.length;
};

const tableAt = (tokens: Token[], at: number): { readonly table: string | null; readonly next: number; readonly temporary: boolean } => {
  const first = nameOf(tokens[at]);
  if (first === null) return { table: null, next: at, temporary: false };
  if (!isMark(tokens[at + 1], '.')) return { table: first, next: at + 1, temporary: false };
  const second = nameOf(tokens[at + 2]);
  const schema = first.toLowerCase();
  const temporary = schema === 'temp' || schema === 'temporary';
  return { table: second === null ? null : schema === 'main' || temporary ? second : `${first}.${second}`, next: at + 3, temporary };
};

const endsClause = (token: Token | undefined): boolean =>
  token !== undefined && 'word' in token && !token.quoted && ENDS.has(token.word.toLowerCase());

const assigned = (tokens: Token[], at: number, columns: Set<string>): number => {
  let index = at;
  for (;;) {
    if (isMark(tokens[index], '(')) {
      const end = pastGroup(tokens, index);
      for (let inner = index + 1; inner < end - 1; inner += 1) {
        const column = nameOf(tokens[inner]);
        if (column !== null) columns.add(column);
      }
      index = end;
    } else {
      const column = nameOf(tokens[index]);
      if (column === null) return tokens.length;
      columns.add(column);
      index += 1;
    }
    if (!isMark(tokens[index], '=')) return tokens.length;
    index += 1;
    while (index < tokens.length && !isMark(tokens[index], ',') && !endsClause(tokens[index])) {
      index = isMark(tokens[index], '(') ? pastGroup(tokens, index) : index + 1;
    }
    if (!isMark(tokens[index], ',')) return index;
    index += 1;
  }
};

export type Verb = 'insert' | 'update' | 'delete';

export type TriggerShape = { readonly on: Verb | null; readonly of: ReadonlySet<string> | null; readonly body: readonly string[] };

export const triggerShape = (sql: string): TriggerShape => {
  const tokens = tokenize(sql);
  const begin = tokens.findIndex((token) => isKeyword(token, 'begin'));
  const head = begin === -1 ? tokens : tokens.slice(0, begin);
  const event = head.findIndex((token) => isKeyword(token, 'insert') || isKeyword(token, 'update') || isKeyword(token, 'delete'));
  const on = event === -1 ? null : (nameOf(head[event])!.toLowerCase() as Verb);
  let of: Set<string> | null = null;
  if (on === 'update' && isKeyword(head[event + 1], 'of')) {
    of = new Set();
    for (let index = event + 2; index < head.length && !isKeyword(head[index], 'on'); index += 1) {
      const column = nameOf(head[index]);
      if (column !== null) of.add(column.toLowerCase());
    }
  }
  return { on, of, body: begin === -1 ? [] : bodyOf(tokens, begin, sql).body };
};

const bodyOf = (tokens: readonly Token[], begin: number, sql: string): { readonly body: readonly string[]; readonly end: number } => {
  let depth = 0;
  let end = -1;
  for (let scan = begin + 1; scan < tokens.length; scan += 1) {
    if (isKeyword(tokens[scan], 'case')) depth += 1;
    else if (isKeyword(tokens[scan], 'end')) {
      if (depth === 0) {
        end = scan;
        break;
      }
      depth -= 1;
    }
  }
  const last = end === -1 ? tokens.length : end;
  const body: string[] = [];
  let from = tokens[begin]!.end;
  for (let scan = begin + 1; scan <= last; scan += 1) {
    if (scan === last || isMark(tokens[scan], ';')) {
      const text = sql.slice(from, scan === last ? (tokens[scan]?.start ?? sql.length) : tokens[scan]!.start).trim();
      if (text !== '') body.push(text);
      if (scan !== last) from = tokens[scan]!.end;
    }
  }
  return { body, end };
};

const written = (
  verb: Verb,
  table: string | null,
  temporary: boolean,
  columns: ReadonlySet<string> | 'all',
  replacing = false,
  conflict?: ConflictPolicy,
): StatementTarget =>
  table === null
    ? UNRESOLVED
    : temporary
      ? { kind: 'other', temporary: true }
      : {
          kind: 'write',
          verb,
          table: table.toLowerCase(),
          columns: replacing || columns === 'all' ? 'all' : new Set([...columns].map((column) => column.toLowerCase())),
          replacing,
          conflict,
        };

const POLICIES: readonly ConflictPolicy[] = ['rollback', 'abort', 'fail', 'ignore', 'replace'];
const conflictAt = (tokens: Token[], at: number): ConflictPolicy | undefined =>
  isKeyword(tokens[at], 'or') ? POLICIES.find((policy) => isKeyword(tokens[at + 1], policy)) : undefined;

const inserted = (tokens: Token[], at: number, replacing: boolean): StatementTarget => {
  let index = at;
  const conflict = replacing ? 'replace' : conflictAt(tokens, index);
  const replacement = conflict === 'replace';
  if (isKeyword(tokens[index], 'or')) index += 2;
  if (!isKeyword(tokens[index], 'into')) return UNRESOLVED;
  const { table, next, temporary } = tableAt(tokens, index + 1);
  index = next;
  if (isKeyword(tokens[index], 'as')) index += 2;
  let columns: Set<string> | 'all' = 'all';
  if (isMark(tokens[index], '(')) {
    const end = pastGroup(tokens, index);
    columns = new Set(tokens.slice(index + 1, end - 1).flatMap((token) => (nameOf(token) === null ? [] : [nameOf(token)!])));
    index = end;
  }
  let updating = false;
  for (; index < tokens.length; index = isMark(tokens[index], '(') ? pastGroup(tokens, index) : index + 1) {
    if (isKeyword(tokens[index], 'do') && isKeyword(tokens[index + 1], 'update') && isKeyword(tokens[index + 2], 'set')) {
      updating = true;
      if (columns !== 'all') index = assigned(tokens, index + 3, columns) - 1;
    }
  }
  const target = written('insert', table, temporary, columns, replacement, conflict);
  return updating && target.kind === 'write' ? { ...target, updating } : target;
};

const updated = (tokens: Token[], at: number): StatementTarget => {
  let index = at;
  const conflict = conflictAt(tokens, index);
  const replacement = conflict === 'replace';
  if (isKeyword(tokens[index], 'or')) index += 2;
  const { table, next, temporary } = tableAt(tokens, index);
  index = next;
  if (isKeyword(tokens[index], 'as')) index += 2;
  else if (nameOf(tokens[index]) !== null && !['set', 'indexed', 'not'].some((word) => isKeyword(tokens[index], word))) index += 1;
  if (isKeyword(tokens[index], 'indexed')) index += 3;
  if (isKeyword(tokens[index], 'not')) index += 2;
  if (!isKeyword(tokens[index], 'set')) return UNRESOLVED;
  const columns = new Set<string>();
  if (assigned(tokens, index + 1, columns) === tokens.length && columns.size === 0) return UNRESOLVED;
  return written('update', table, temporary, columns, replacement, conflict);
};

const deleted = (tokens: Token[], at: number): StatementTarget => {
  if (!isKeyword(tokens[at], 'from')) return UNRESOLVED;
  const { table, temporary } = tableAt(tokens, at + 1);
  return written('delete', table, temporary, 'all');
};

const defined = (tokens: Token[], at: number): StatementTarget => {
  let index = at;
  while (
    index < tokens.length &&
    !isKeyword(tokens[index], 'table') &&
    !isKeyword(tokens[index], 'index') &&
    !isKeyword(tokens[index], 'trigger') &&
    !isKeyword(tokens[index], 'view')
  ) {
    if (isKeyword(tokens[index], 'temp') || isKeyword(tokens[index], 'temporary')) return OTHER;
    index += 1;
  }
  index += 1;
  while (isKeyword(tokens[index], 'if') || isKeyword(tokens[index], 'not') || isKeyword(tokens[index], 'exists')) index += 1;
  return tableAt(tokens, index).temporary ? OTHER : UNRESOLVED;
};

const WRITING = new Set(['insert', 'replace', 'update', 'delete', 'with', 'create', 'drop', 'alter']);

const REMEMBERED = 1024;

const remembered = new Map<string, StatementTarget>();

const leadingWord = (sql: string): string | null => {
  let at = 0;
  for (;;) {
    while (at < sql.length && (/\s/.test(sql[at]!) || sql[at] === ';')) at += 1;
    if (sql.startsWith('--', at)) {
      const line = sql.indexOf('\n', at);
      if (line === -1) return null;
      at = line + 1;
    } else if (sql.startsWith('/*', at)) {
      const end = sql.indexOf('*/', at + 2);
      if (end === -1) return null;
      at = end + 2;
    } else break;
  }
  const end = wordEnd(sql, at);
  return end === -1 ? null : sql.slice(at, end).toLowerCase();
};

const single = (sql: string): boolean => {
  const semicolon = sql.indexOf(';');
  return semicolon === -1 || sql.slice(semicolon + 1).trim() === '';
};

export const statementTarget = (sql: string): StatementTarget => {
  const word = leadingWord(sql);
  if (single(sql) && (word === null || !WRITING.has(word))) return OTHER;
  const known = remembered.get(sql);
  if (known !== undefined) return known;
  const target = targetOf(sql);
  if (remembered.size >= REMEMBERED) remembered.delete(remembered.keys().next().value!);
  remembered.set(sql, target);
  return target;
};

const targetOf = (sql: string): StatementTarget => {
  const all = tokenize(sql);
  let start = 0;
  while (isMark(all[start], ';')) start += 1;
  const end = all.findIndex((token, at) => at >= start && isMark(token, ';'));
  if (end !== -1 && all.slice(end).some((token) => !isMark(token, ';'))) return UNRESOLVED;
  const tokens = all.slice(start, end === -1 ? all.length : end);
  let index = 0;
  if (isKeyword(tokens[index], 'with')) {
    index += isKeyword(tokens[index + 1], 'recursive') ? 2 : 1;
    for (;;) {
      if (nameOf(tokens[index]) === null) return UNRESOLVED;
      index += 1;
      if (isMark(tokens[index], '(')) index = pastGroup(tokens, index);
      if (!isKeyword(tokens[index], 'as')) return UNRESOLVED;
      index += 1;
      if (isKeyword(tokens[index], 'not')) index += 1;
      if (isKeyword(tokens[index], 'materialized')) index += 1;
      if (!isMark(tokens[index], '(')) return UNRESOLVED;
      index = pastGroup(tokens, index);
      if (!isMark(tokens[index], ',')) break;
      index += 1;
    }
  }
  const verb = nameOf(tokens[index])?.toLowerCase();
  if (verb === 'insert' || verb === 'replace') return inserted(tokens, index + 1, verb === 'replace');
  if (verb === 'update') return updated(tokens, index + 1);
  if (verb === 'delete') return deleted(tokens, index + 1);
  if (verb === 'create' || verb === 'drop' || verb === 'alter') return defined(tokens, index + 1);
  return OTHER;
};

export const isExternalContent = (definition: string): boolean => {
  const tokens = tokenize(definition);
  const using = tokens.findIndex((token) => isKeyword(token, 'using'));
  if (using === -1 || !(isKeyword(tokens[using + 1], 'fts5') || isKeyword(tokens[using + 1], 'fts4')) || !isMark(tokens[using + 2], '('))
    return false;
  const end = pastGroup(tokens, using + 2);
  for (let index = using + 3; index < end - 1; index += 1) {
    if (!isKeyword(tokens[index], 'content') || !isMark(tokens[index + 1], '=')) continue;
    const value = tokens[index + 2];
    const name =
      value !== undefined && 'mark' in value && value.mark === "'" ? definition.slice(value.start + 1, value.end - 1) : nameOf(value);
    return name !== null && name !== '';
  }
  return false;
};

export type SchemaStatement =
  | { readonly kind: 'other' }
  | { readonly kind: 'unresolved' }
  | { readonly kind: 'create-table'; readonly table: string; readonly temporary: boolean }
  | { readonly kind: 'drop-table'; readonly table: string; readonly temporary: boolean }
  | {
      readonly kind: 'alter-table';
      readonly table: string;
      readonly temporary: boolean;
      readonly renameTo: string | null;
      readonly addedColumn: string | null;
    }
  | { readonly kind: 'create-index'; readonly index: string; readonly table: string; readonly temporary: boolean }
  | { readonly kind: 'drop-index'; readonly index: string; readonly temporary: boolean }
  | {
      readonly kind: 'create-trigger';
      readonly trigger: string;
      readonly table: string;
      readonly temporary: boolean;
      readonly body: readonly string[];
    }
  | { readonly kind: 'drop-trigger'; readonly trigger: string; readonly temporary: boolean }
  | { readonly kind: 'create-view'; readonly view: string; readonly temporary: boolean }
  | { readonly kind: 'drop-view'; readonly view: string; readonly temporary: boolean }
  | { readonly kind: 'legacy-alter'; readonly on: boolean };

const SCHEMA_OTHER: SchemaStatement = { kind: 'other' };
const SCHEMA_UNRESOLVED: SchemaStatement = { kind: 'unresolved' };
const ADDED_RESERVED = new Set(['constraint', 'primary', 'foreign', 'unique', 'check', 'key', 'if', 'not', 'exists']);

const pastExists = (tokens: Token[], at: number): number => {
  let index = at;
  while (isKeyword(tokens[index], 'if') || isKeyword(tokens[index], 'not') || isKeyword(tokens[index], 'exists')) index += 1;
  return index;
};

const targetName = (tokens: Token[], at: number): { readonly name: string | null; readonly temporary: boolean; readonly next: number } => {
  const first = nameOf(tokens[at]);
  if (first === null) return { name: null, temporary: false, next: at };
  if (!isMark(tokens[at + 1], '.')) return { name: first.toLowerCase(), temporary: false, next: at + 1 };
  const second = nameOf(tokens[at + 2]);
  if (second === null) return { name: null, temporary: false, next: at + 3 };
  const schema = first.toLowerCase();
  if (schema === 'temp' || schema === 'temporary') return { name: second.toLowerCase(), temporary: true, next: at + 3 };
  if (schema === 'main') return { name: second.toLowerCase(), temporary: false, next: at + 3 };
  return { name: null, temporary: false, next: at + 3 };
};

const bareName = (tokens: Token[], at: number): { readonly name: string | null; readonly next: number } => {
  const name = nameOf(tokens[at]);
  if (name === null || isMark(tokens[at + 1], '.')) return { name: null, next: at };
  return { name: name.toLowerCase(), next: at + 1 };
};

const tailOnly = (tokens: Token[], from: number): boolean => tokens.slice(from).every((token) => isMark(token, ';'));

const isSingle = (tokens: Token[], from: number): boolean => {
  const end = tokens.findIndex((token, at) => at >= from && isMark(token, ';'));
  return end === -1 || tailOnly(tokens, end);
};

const createdTable = (tokens: Token[], at: number, temporary: boolean): SchemaStatement => {
  const index = pastExists(tokens, at);
  const target = targetName(tokens, index);
  if (target.name === null) return SCHEMA_UNRESOLVED;
  if (isKeyword(tokens[target.next], 'as') && !(temporary || target.temporary)) return SCHEMA_UNRESOLVED;
  if (!isSingle(tokens, at)) return SCHEMA_UNRESOLVED;
  return { kind: 'create-table', table: target.name, temporary: temporary || target.temporary };
};

const createdIndex = (tokens: Token[], at: number, temporary: boolean): SchemaStatement => {
  const found = pastExists(tokens, at);
  const named = targetName(tokens, found);
  if (named.name === null) return SCHEMA_UNRESOLVED;
  if (!isKeyword(tokens[named.next], 'on')) return SCHEMA_UNRESOLVED;
  const owner = targetName(tokens, named.next + 1);
  if (owner.name === null) return SCHEMA_UNRESOLVED;
  if (!isSingle(tokens, at)) return SCHEMA_UNRESOLVED;
  return { kind: 'create-index', index: named.name, table: owner.name, temporary: temporary || named.temporary || owner.temporary };
};

const createdTrigger = (tokens: Token[], at: number, sql: string, temporary: boolean): SchemaStatement => {
  const index = pastExists(tokens, at);
  const named = targetName(tokens, index);
  if (named.name === null) return SCHEMA_UNRESOLVED;
  let on = -1;
  let begin = -1;
  for (let scan = named.next; scan < tokens.length; scan += 1) {
    if (isKeyword(tokens[scan], 'begin')) {
      begin = scan;
      break;
    }
    if (on === -1 && isKeyword(tokens[scan], 'on')) on = scan;
  }
  if (on === -1 || begin === -1) return SCHEMA_UNRESOLVED;
  const owner = targetName(tokens, on + 1);
  if (owner.name === null) return SCHEMA_UNRESOLVED;
  if (!isKeyword(tokens[owner.next], 'when') && !isKeyword(tokens[owner.next], 'begin')) return SCHEMA_UNRESOLVED;
  const { body, end } = bodyOf(tokens, begin, sql);
  if (end === -1 || !tailOnly(tokens, end + 1)) return SCHEMA_UNRESOLVED;
  return {
    kind: 'create-trigger',
    trigger: named.name,
    table: owner.name,
    temporary: temporary || named.temporary || owner.temporary,
    body,
  };
};

const createdView = (tokens: Token[], at: number, temporary: boolean): SchemaStatement => {
  let index = pastExists(tokens, at);
  const target = targetName(tokens, index);
  if (target.name === null) return SCHEMA_UNRESOLVED;
  index = target.next;
  if (isMark(tokens[index], '(')) index = pastGroup(tokens, index);
  if (!isKeyword(tokens[index], 'as')) return SCHEMA_UNRESOLVED;
  if (!isSingle(tokens, at)) return SCHEMA_UNRESOLVED;
  return { kind: 'create-view', view: target.name, temporary: temporary || target.temporary };
};

const created = (tokens: Token[], at: number, sql: string): SchemaStatement => {
  let index = at;
  let temporary = false;
  if (isKeyword(tokens[index], 'temp') || isKeyword(tokens[index], 'temporary')) {
    temporary = true;
    index += 1;
  }
  if (isKeyword(tokens[index], 'virtual')) {
    if (!isKeyword(tokens[index + 1], 'table')) return SCHEMA_UNRESOLVED;
    return createdTable(tokens, index + 2, temporary);
  }
  if (isKeyword(tokens[index], 'table')) return createdTable(tokens, index + 1, temporary);
  if (isKeyword(tokens[index], 'index')) return createdIndex(tokens, index + 1, temporary);
  if (isKeyword(tokens[index], 'trigger')) return createdTrigger(tokens, index + 1, sql, temporary);
  if (isKeyword(tokens[index], 'view')) return createdView(tokens, index + 1, temporary);
  if (isKeyword(tokens[index], 'unique')) {
    if (!isKeyword(tokens[index + 1], 'index')) return SCHEMA_UNRESOLVED;
    return createdIndex(tokens, index + 2, temporary);
  }
  return SCHEMA_UNRESOLVED;
};

const droppedTable = (tokens: Token[], at: number, temporary: boolean): SchemaStatement => {
  const index = pastExists(tokens, at);
  const target = targetName(tokens, index);
  if (target.name === null) return SCHEMA_UNRESOLVED;
  if (!isSingle(tokens, at)) return SCHEMA_UNRESOLVED;
  return { kind: 'drop-table', table: target.name, temporary: temporary || target.temporary };
};

const droppedIndex = (tokens: Token[], at: number, temporary: boolean): SchemaStatement => {
  const index = pastExists(tokens, at);
  const target = targetName(tokens, index);
  if (target.name === null) return SCHEMA_UNRESOLVED;
  if (!isSingle(tokens, at)) return SCHEMA_UNRESOLVED;
  return { kind: 'drop-index', index: target.name, temporary: temporary || target.temporary };
};

const droppedTrigger = (tokens: Token[], at: number, temporary: boolean): SchemaStatement => {
  const index = pastExists(tokens, at);
  const target = targetName(tokens, index);
  if (target.name === null) return SCHEMA_UNRESOLVED;
  if (!isSingle(tokens, at)) return SCHEMA_UNRESOLVED;
  return { kind: 'drop-trigger', trigger: target.name, temporary: temporary || target.temporary };
};

const droppedView = (tokens: Token[], at: number, temporary: boolean): SchemaStatement => {
  const index = pastExists(tokens, at);
  const target = targetName(tokens, index);
  if (target.name === null) return SCHEMA_UNRESOLVED;
  if (!isSingle(tokens, at)) return SCHEMA_UNRESOLVED;
  return { kind: 'drop-view', view: target.name, temporary: temporary || target.temporary };
};

const dropped = (tokens: Token[], at: number): SchemaStatement => {
  let index = at;
  let temporary = false;
  if (isKeyword(tokens[index], 'temp') || isKeyword(tokens[index], 'temporary')) {
    temporary = true;
    index += 1;
  }
  if (isKeyword(tokens[index], 'table')) return droppedTable(tokens, index + 1, temporary);
  if (isKeyword(tokens[index], 'index')) return droppedIndex(tokens, index + 1, temporary);
  if (isKeyword(tokens[index], 'trigger')) return droppedTrigger(tokens, index + 1, temporary);
  if (isKeyword(tokens[index], 'view')) return droppedView(tokens, index + 1, temporary);
  return SCHEMA_UNRESOLVED;
};

const altered = (tokens: Token[], at: number): SchemaStatement => {
  if (!isKeyword(tokens[at], 'table')) return SCHEMA_UNRESOLVED;
  const target = targetName(tokens, at + 1);
  if (target.name === null) return SCHEMA_UNRESOLVED;
  let index = target.next;
  let renameTo: string | null = null;
  let addedColumn: string | null = null;
  if (isKeyword(tokens[index], 'rename')) {
    index += 1;
    if (isKeyword(tokens[index], 'column')) index += 1;
    else if (isKeyword(tokens[index], 'to')) {
      index += 1;
      const bare = bareName(tokens, index);
      if (bare.name === null) return SCHEMA_UNRESOLVED;
      renameTo = bare.name;
      index = bare.next;
    }
  } else if (isKeyword(tokens[index], 'add')) {
    index += 1;
    if (isKeyword(tokens[index], 'column')) index += 1;
    const head = tokens[index];
    if (head === undefined || !('word' in head) || (!head.quoted && ADDED_RESERVED.has(head.word.toLowerCase()))) return SCHEMA_UNRESOLVED;
    const column = bareName(tokens, index);
    if (column.name === null) return SCHEMA_UNRESOLVED;
    addedColumn = column.name;
    index = column.next;
  }
  if (!isSingle(tokens, index)) return SCHEMA_UNRESOLVED;
  return { kind: 'alter-table', table: target.name, temporary: target.temporary, renameTo, addedColumn };
};

const SWITCHES: Readonly<Record<string, boolean>> = {
  on: true,
  true: true,
  yes: true,
  '1': true,
  off: false,
  false: false,
  no: false,
  '0': false,
};

const switchOf = (token: Token | undefined): boolean | null => {
  if (token === undefined) return null;
  const said = 'word' in token ? token.word.toLowerCase() : token.mark;
  return SWITCHES[said] ?? null;
};

const pragma = (tokens: Token[], at: number): SchemaStatement => {
  let index = at;
  let schema: string | null = null;
  const first = nameOf(tokens[index]);
  if (first === null) return SCHEMA_UNRESOLVED;
  if (isMark(tokens[index + 1], '.')) {
    schema = first.toLowerCase();
    index += 2;
  }
  const raw = nameOf(tokens[index]);
  if (raw === null) return SCHEMA_UNRESOLVED;
  if (schema !== null && schema !== 'main') return SCHEMA_UNRESOLVED;
  const name = raw.toLowerCase();
  index += 1;
  if (name === 'foreign_keys' || name === 'legacy_alter_table') {
    if (isMark(tokens[index], ';') || index >= tokens.length) return isSingle(tokens, index) ? SCHEMA_OTHER : SCHEMA_UNRESOLVED;
    if (!isMark(tokens[index], '=')) return SCHEMA_UNRESOLVED;
    const on = switchOf(tokens[index + 1]);
    if (on === null || !isSingle(tokens, index + 2)) return SCHEMA_UNRESOLVED;
    return name === 'legacy_alter_table' ? { kind: 'legacy-alter', on } : SCHEMA_OTHER;
  }
  if (name === 'foreign_key_check') {
    let next = index;
    if (isMark(tokens[next], '(')) next = pastGroup(tokens, next);
    else if (next < tokens.length && !isMark(tokens[next], ';')) return SCHEMA_UNRESOLVED;
    return isSingle(tokens, next) ? SCHEMA_OTHER : SCHEMA_UNRESOLVED;
  }
  return SCHEMA_UNRESOLVED;
};

export const schemaStatement = (sql: string): SchemaStatement => {
  const all = tokenize(sql);
  let start = 0;
  while (isMark(all[start], ';')) start += 1;
  if (start >= all.length) return SCHEMA_OTHER;
  if (isKeyword(all[start], 'create')) return created(all, start + 1, sql);
  if (isKeyword(all[start], 'drop')) return dropped(all, start + 1);
  if (isKeyword(all[start], 'alter')) return altered(all, start + 1);
  if (isKeyword(all[start], 'pragma')) return pragma(all, start + 1);
  if (isKeyword(all[start], 'select')) return isSingle(all, start + 1) ? SCHEMA_OTHER : SCHEMA_UNRESOLVED;
  return SCHEMA_UNRESOLVED;
};
