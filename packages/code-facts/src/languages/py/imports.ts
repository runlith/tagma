import { createHash } from 'node:crypto';
import type { Declaration, Metrics } from '../../adapter';
import { type ImportSite, UnsupportedSource } from '../../imports';
import { language } from './language';
import { type Logical, logicalLines, type Token } from './lexer';

export type Reading = { readonly sites: readonly ImportSite[]; readonly declarations: readonly Declaration[]; readonly metrics: Metrics };

type Block = { readonly indent: number; readonly kind: 'def' | 'class' | 'checking' | 'other' };

const COMPOUND = new Set([
  'if',
  'elif',
  'else',
  'for',
  'while',
  'try',
  'except',
  'finally',
  'with',
  'def',
  'class',
  'async',
  'match',
  'case',
]);

const KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

const EXTENSIONS: ReadonlySet<string> = new Set(language.extensions);

export const parses = (path: string): boolean => {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') && EXTENSIONS.has(path.slice(dot));
};

const isOp = (token: Token | undefined, text: string): boolean => token?.kind === 'op' && token.text === text;

const isName = (token: Token | undefined, text?: string): boolean => token?.kind === 'name' && (text === undefined || token.text === text);

const statementsOf = (tokens: readonly Token[]): readonly (readonly Token[])[] => {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'op' && '([{'.includes(token.text)) depth += 1;
    if (token.kind === 'op' && ')]}'.includes(token.text)) depth -= 1;
    if (depth === 0 && isOp(token, ';')) parts.push([]);
    else parts.at(-1)?.push(token);
  }
  return parts.filter((part) => part.length > 0);
};

const headerColon = (tokens: readonly Token[]): number => {
  let depth = 0;
  let lambdas = 0;
  for (const [at, token] of tokens.entries()) {
    if (token.kind === 'op' && '([{'.includes(token.text)) depth += 1;
    else if (token.kind === 'op' && ')]}'.includes(token.text)) depth -= 1;
    else if (depth === 0 && isName(token, 'lambda')) lambdas += 1;
    else if (depth === 0 && isOp(token, ':') && !isOp(tokens[at + 1], '=')) {
      if (lambdas > 0) lambdas -= 1;
      else return at;
    }
  }
  return -1;
};

const dotted = (tokens: readonly Token[], from: number): { readonly name: string; readonly next: number } => {
  let name = '';
  let at = from;
  while (isOp(tokens[at], '.') || (isName(tokens[at]) && !isName(tokens[at], 'import'))) {
    name += (tokens[at] as Token).text;
    at += 1;
    if (isName(tokens[at - 1]) && !isOp(tokens[at], '.')) break;
  }
  return { name, next: at };
};

const digest = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function read(source: string, path: string): Reading {
  const sites: ImportSite[] = [];
  const declarations: Declaration[] = [];
  const cuts: [number, number][] = [];
  let importLines = 0;
  const stack: Block[] = [];
  const levels: number[] = [0];
  let opening = false;
  const checking = new Set(['TYPE_CHECKING']);
  const callers = new Set(['__import__', 'import_module']);
  const importlibs = new Set(['importlib']);
  const loads = (): ImportSite['loads'] =>
    stack.some((block) => block.kind === 'checking') ? 'never' : stack.some((block) => block.kind === 'def') ? 'lazily' : 'with-module';
  const declare = (name: string, kind: Declaration['kind'], line: number): void => {
    if (!stack.some((block) => block.kind === 'def' || block.kind === 'class'))
      declarations.push({ name, kind, line, exported: !name.startsWith('_') });
  };
  const site = (specifier: string, line: number, forwards: boolean, kind?: ImportSite['kind']): void => {
    sites.push({
      specifier,
      line,
      clause: kind === undefined,
      loads: kind === undefined ? loads() : 'lazily',
      forwards,
      form: 'import',
      kind,
    });
  };
  const checkingCondition = (tokens: readonly Token[]): boolean =>
    (tokens.length === 2 && isName(tokens[1]) && checking.has((tokens[1] as Token).text)) ||
    (tokens.length === 4 && isName(tokens[1]) && isOp(tokens[2], '.') && isName(tokens[3], 'TYPE_CHECKING'));
  const formatted = (token: Token): void => {
    const names = [...callers].join('|');
    const modules = [...importlibs].join('|');
    const call = new RegExp(
      `(?:^|[^\\w.])(?:${names})\\s*\\(|(?:^|[^\\w.])(?:${modules})\\s*\\.\\s*import_module\\s*\\(|\\.\\s*__import__\\s*\\(`,
      'u',
    );
    for (const expression of token.expressions ?? []) if (call.test(expression)) site(expression.trim(), token.line, false, 'unresolved');
  };
  const dynamic = (tokens: readonly Token[]): void => {
    for (const [at, token] of tokens.entries()) {
      if (token.kind === 'string') formatted(token);
      if (!isOp(tokens[at + 1], '(') || isName(tokens[at - 1], 'def')) continue;
      const member = isOp(tokens[at - 1], '.');
      const called =
        isName(token, '__import__') ||
        (isName(token) && !member && callers.has(token.text)) ||
        (isName(token, 'import_module') && member && isName(tokens[at - 2]) && importlibs.has((tokens[at - 2] as Token).text));
      if (!called) continue;
      const argument = tokens[at + 2];
      const closed = isOp(tokens[at + 3], ')') || isOp(tokens[at + 3], ',');
      if (argument?.kind === 'string' && argument.value !== undefined && closed && !argument.value.startsWith('.')) {
        sites.push({ specifier: argument.value, line: token.line, clause: false, loads: 'lazily', forwards: false, form: 'import' });
        continue;
      }
      let depth = 0;
      let stop = at + 1;
      for (; stop < tokens.length; stop += 1) {
        const held = tokens[stop] as Token;
        if (held.kind === 'op' && '([{'.includes(held.text)) depth += 1;
        if (held.kind === 'op' && ')]}'.includes(held.text)) depth -= 1;
        if (depth === 0) break;
      }
      const inside = tokens.slice(at + 2, stop);
      const written = inside.length === 0 ? '' : source.slice((inside[0] as Token).start, (inside.at(-1) as Token).end);
      site(`${token.text}(${written})`, token.line, false, 'unresolved');
    }
  };
  const importStatement = (tokens: readonly Token[]): boolean => {
    const first = tokens[0] as Token;
    const last = tokens.at(-1) as Token;
    const counted = !stack.some((block) => block.kind === 'def');
    const note = () => {
      if (!counted) return;
      importLines += last.line - first.line + 1;
      if (stack.length === 0) cuts.push([first.start, last.end]);
    };
    if (isName(first, 'import')) {
      let at = 1;
      while (at < tokens.length) {
        const { name, next } = dotted(tokens, at);
        if (name === '') break;
        at = next;
        let alias: string | undefined;
        if (isName(tokens[at], 'as')) {
          alias = tokens[at + 1]?.text;
          at += 2;
        }
        site(name, first.line, alias !== undefined && alias === name);
        if (name === 'importlib') importlibs.add(alias ?? name);
        if (!isOp(tokens[at], ',')) break;
        at += 1;
      }
      note();
      return true;
    }
    if (!isName(first, 'from')) return false;
    const { name: module, next } = dotted(tokens, 1);
    if (!isName(tokens[next], 'import') || module === '') return false;
    let at = next + 1;
    if (isOp(tokens[at], '(')) at += 1;
    if (isOp(tokens[at], '*')) site(module, first.line, true);
    else {
      while (isName(tokens[at])) {
        const { text: name, line } = tokens[at] as Token;
        at += 1;
        let alias: string | undefined;
        if (isName(tokens[at], 'as')) {
          alias = tokens[at + 1]?.text;
          at += 2;
        }
        site(`${module}:${name}`, line, alias === name);
        if (module === 'importlib' && name === 'import_module') callers.add(alias ?? name);
        if ((module === 'typing' || module === 'typing_extensions') && name === 'TYPE_CHECKING') checking.add(alias ?? name);
        if (!isOp(tokens[at], ',')) break;
        at += 1;
      }
    }
    note();
    return true;
  };
  const assigned = (tokens: readonly Token[]): void => {
    if (isName(tokens[0], 'type') && isName(tokens[1]) && (isOp(tokens[2], '=') || isOp(tokens[2], '['))) {
      declare((tokens[1] as Token).text, 'type', (tokens[1] as Token).line);
      return;
    }
    const names: Token[] = [];
    let at = 0;
    while (isName(tokens[at]) && !KEYWORDS.has((tokens[at] as Token).text)) {
      names.push(tokens[at] as Token);
      at += 1;
      if (!isOp(tokens[at], ',')) break;
      at += 1;
    }
    const annotated = names.length === 1 && isOp(tokens[at], ':');
    const bound = isOp(tokens[at], '=') && !isOp(tokens[at + 1], '=');
    if (annotated || bound) for (const name of names) declare(name.text, 'variable', name.line);
  };
  const simple = (tokens: readonly Token[]): void => {
    for (const statement of statementsOf(tokens)) {
      if (importStatement(statement)) continue;
      dynamic(statement);
      assigned(statement);
    }
  };
  const fail = (line: number, why: string): never => {
    throw new UnsupportedSource(path, `does not parse at line ${line}: ${why}`);
  };
  const indented = (logical: Logical): void => {
    const line = (logical.tokens[0] as Token).line;
    const top = levels.at(-1) as number;
    if (opening) {
      if (logical.indent <= top) fail(line, 'a block holds no indented body');
      levels.push(logical.indent);
      opening = false;
      return;
    }
    if (logical.indent > top) fail(line, 'a line is indented where no block opens');
    while ((levels.at(-1) as number) > logical.indent) levels.pop();
    if (levels.at(-1) !== logical.indent) fail(line, 'a dedent matches no enclosing block');
  };
  const visit = (logical: Logical): void => {
    indented(logical);
    while ((stack.at(-1)?.indent ?? -1) >= logical.indent) stack.pop();
    const { tokens } = logical;
    const first = tokens[0] as Token;
    const colon = isName(first) && COMPOUND.has(first.text) ? headerColon(tokens) : -1;
    if (colon === -1) {
      simple(tokens);
      return;
    }
    const header = tokens.slice(0, colon);
    dynamic(header);
    const keyword = isName(first, 'async') ? tokens[1]?.text : first.text;
    const named = isName(first, 'async') ? tokens[2] : tokens[1];
    if (keyword === 'def' && isName(named)) declare((named as Token).text, 'function', (named as Token).line);
    if (keyword === 'class' && isName(named)) declare((named as Token).text, 'class', (named as Token).line);
    const kind: Block['kind'] =
      keyword === 'def' ? 'def' : keyword === 'class' ? 'class' : keyword === 'if' && checkingCondition(header) ? 'checking' : 'other';
    stack.push({ indent: logical.indent, kind });
    const body = tokens.slice(colon + 1);
    if (body.length > 0) simple(body);
    else opening = true;
  };
  const logicals = logicalLines(source, path);
  for (const logical of logicals) visit(logical);
  if (opening) fail((logicals.at(-1)?.tokens[0] as Token).line, 'a block holds no indented body');
  let body = '';
  let from = 0;
  for (const [start, end] of cuts) {
    body += source.slice(from, start);
    from = end;
  }
  body += source.slice(from);
  const lines = source === '' ? 0 : source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  return {
    sites,
    declarations,
    metrics: { lines, importLines, size: Buffer.byteLength(source, 'utf8'), body: digest(body.replace(/\s+/g, ' ').trim()) },
  };
}
