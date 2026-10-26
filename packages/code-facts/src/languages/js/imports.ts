import { parse, type ParserOptions, parseSync } from 'oxc-parser';
import { type ImportSite, UnsupportedSource } from '../../imports';
import { language } from './language';

export type Parsed = Pick<ReturnType<typeof parseSync>, 'program' | 'module' | 'errors'>;

export type Script = { readonly text: string; readonly at: number; readonly tries: readonly ParserOptions[]; readonly module: boolean };

export type Embedded = { readonly text: string; readonly at: number; readonly module: boolean };

export type Embedding = {
  readonly extensions: readonly string[];
  readonly scripts: (source: string, path: string) => readonly Embedded[];
};

export type Scripts = (source: string, path: string) => readonly Script[];

const TS: readonly ParserOptions[] = [{ lang: 'ts', sourceType: 'module' }];
const JS_MODULE: ParserOptions = { lang: 'jsx', sourceType: 'module' };
const JS_COMMONJS: ParserOptions = { lang: 'jsx', sourceType: 'commonjs' };

const PARSED_AS: { readonly [E in (typeof language.extensions)[number]]: readonly ParserOptions[] } = {
  '.ts': TS,
  '.mts': TS,
  '.cts': [{ lang: 'ts', sourceType: 'commonjs' }],
  '.tsx': [{ lang: 'tsx', sourceType: 'module' }],
  '.js': [JS_MODULE, JS_COMMONJS],
  '.mjs': [JS_MODULE],
  '.cjs': [JS_COMMONJS],
  '.jsx': [JS_MODULE, JS_COMMONJS],
};

const QUOTED = /^(['"])([^'"\\\n]*)\1$/;

const GAP = String.raw`(?:\s|\/\*[^]*?\*\/|\/\/[^\n]*\n)*`;

const BEYOND_MODULE_RECORD = new RegExp(
  String.raw`\b(?:require\b|export${GAP}(?:type${GAP})?\{${GAP}\}${GAP}from\b|export${GAP}=|declare\s+(?:module|global|namespace)\b|namespace\s+[\w$.]+\s*\{)`,
);

const ESCAPED_NAME =
  /(?:[\w$]|\\u(?:\{[0-9a-fA-F]+\}|[0-9a-fA-F]{4}))*\\u(?:\{[0-9a-fA-F]+\}|[0-9a-fA-F]{4})(?:[\w$]|\\u(?:\{[0-9a-fA-F]+\}|[0-9a-fA-F]{4}))*/g;

const escapedRequire = (text: string): boolean => {
  if (!text.includes('\\u')) return false;
  for (const [name] of text.matchAll(ESCAPED_NAME)) {
    const decoded = name.replace(/\\u\{?([0-9a-fA-F]+)\}?/g, (_, code: string) => {
      const point = Number.parseInt(code, 16);
      return point > 0x10ffff ? '\\' : String.fromCodePoint(point);
    });
    if (decoded === 'require') return true;
  }
  return false;
};

const IMPORT_CALL = /\bimport\s*(?:\/\*[^]*?\*\/\s*|\/\/[^\n]*\n\s*)*\(/g;

export const extensionOf = (path: string): string => {
  const at = path.lastIndexOf('.');
  return at === -1 || path.lastIndexOf('/') > at ? '' : path.slice(at);
};

export function importSites(source: string, path: string, scriptsOf: Scripts): readonly ImportSite[] {
  return sitesOf(
    source,
    path,
    scriptsOf(source, path).map((script) => ({ script, parsed: parsedNow(path, script) })),
  );
}

export async function importSitesOffThread(source: string, path: string, scriptsOf: Scripts): Promise<readonly ImportSite[]> {
  const scripts = scriptsOf(source, path);
  const parsed = await Promise.all(scripts.map((script) => parsedLater(path, script)));
  return sitesOf(
    source,
    path,
    scripts.map((script, at) => ({ script, parsed: parsed[at] as Parsed })),
  );
}

export const failureOf = (parsed: Parsed) => parsed.errors.find((error) => error.severity === 'Error');

export function parsedNow(path: string, script: Script): Parsed {
  let first: Parsed | undefined;
  for (const options of script.tries) {
    const parsed = parseSync(path, script.text, options);
    if (failureOf(parsed) === undefined) return parsed;
    first ??= parsed;
  }
  return first as Parsed;
}

async function parsedLater(path: string, script: Script): Promise<Parsed> {
  let first: Parsed | undefined;
  for (const options of script.tries) {
    const parsed = await parse(path, script.text, options);
    if (failureOf(parsed) === undefined) return parsed;
    first ??= parsed;
  }
  return first as Parsed;
}

export function scriptsWith(embeddings: readonly Embedding[]): Scripts {
  const hosts = new Map(embeddings.flatMap((embedding) => embedding.extensions.map((extension) => [extension, embedding] as const)));
  return (source, path) => {
    const extension = extensionOf(path);
    const tries = Object.hasOwn(PARSED_AS, extension) ? PARSED_AS[extension as keyof typeof PARSED_AS] : undefined;
    if (tries !== undefined) return [{ text: source, at: 0, tries, module: true }];
    const host = hosts.get(extension);
    if (host === undefined)
      throw new UnsupportedSource(path, `no parser here reads ${extension === '' ? 'a name with no extension' : extension}`);
    return host.scripts(source, path).map((script) => ({ ...script, tries: TS }));
  };
}

type Found = {
  readonly specifier: string;
  readonly at: number;
  readonly clause: boolean;
  readonly loads: ImportSite['loads'];
  readonly forwards: boolean;
  readonly form?: ImportSite['form'];
  readonly kind?: ImportSite['kind'];
  readonly patterns?: readonly string[];
};

type Forwarding = {
  readonly bound: Map<string, number>;
  readonly exported: string[];
  readonly at: Set<number>;
};

export function sitesOf(
  source: string,
  path: string,
  parsed: readonly { readonly script: Script; readonly parsed: Parsed }[],
): readonly ImportSite[] {
  const found: Found[] = [];
  for (const { script, parsed: one } of parsed) {
    const failed = failureOf(one);
    if (failed !== undefined) {
      const at = failed.labels[0]?.start;
      const where = at === undefined ? '' : ` at line ${linesUpTo(source, [script.at + at])[0]}`;
      throw new UnsupportedSource(path, `does not parse${where}: ${failed.message}`);
    }
    for (const site of scriptSites(script.text, one))
      found.push({ ...site, at: script.at + site.at, forwards: script.module && site.forwards });
  }
  found.sort((left, right) => left.at - right.at);
  const lines = linesUpTo(
    source,
    found.map(({ at }) => at),
  );
  return found.map(({ at: _, ...site }, at) => ({ ...site, form: site.form ?? 'import', line: lines[at] as number }));
}

function scriptSites(text: string, parsed: Parsed): readonly Found[] {
  const found: Found[] = [];
  const forwarding: Forwarding = { bound: new Map(), exported: [], at: new Set() };
  const module = parsed.module;
  const macros = new Set<number>();
  if (module.staticImports.some((statement) => /\b(?:with|assert)\b/.test(text.slice(statement.moduleRequest.end, statement.end)))) {
    for (const statement of parsed.program.body) {
      if (statement.type === 'ImportDeclaration' && macroImport(statement)) macros.add(statement.start);
    }
  }
  for (const statement of module.staticImports) {
    const { value, start } = statement.moduleRequest;
    const entries = statement.entries;
    const head = entries.length === 0 ? text.slice(statement.start, start) : '';
    const clause = entries.length > 0 || head.includes('{');
    const typeOnly = entries.length > 0 ? entries.every((entry) => entry.isType) : clause && /^import\s+type\b/.test(head);
    found.push({
      specifier: value,
      at: start,
      clause,
      loads: typeOnly || macros.has(statement.start) ? 'never' : 'with-module',
      forwards: false,
    });
    for (const entry of entries) forwarding.bound.set(entry.localName.value, start);
  }
  const imported = new Set(module.staticImports.map((statement) => statement.start));
  for (const statement of module.staticExports) {
    for (const entry of statement.entries) {
      if (entry.moduleRequest !== null) forwarding.at.add(entry.moduleRequest.start);
      else if (entry.localName.name !== null) forwarding.exported.push(entry.localName.name);
    }
    if (imported.has(statement.start)) continue;
    const named = statement.entries.filter(({ moduleRequest }) => moduleRequest !== null);
    const request = named[0]?.moduleRequest;
    if (request === undefined || request === null) continue;
    const typeOnly = named.every((entry) => entry.isType);
    found.push({ specifier: request.value, at: request.start, clause: true, loads: typeOnly ? 'never' : 'with-module', forwards: true });
  }
  const lazy = module.dynamicImports.map(({ moduleRequest }) => ({
    at: moduleRequest.start,
    written: text.slice(moduleRequest.start, moduleRequest.end),
  }));
  const walked =
    BEYOND_MODULE_RECORD.test(text) ||
    escapedRequire(text) ||
    /\b(?:URL|glob)\b/.test(text) ||
    lazy.some(({ written }) => !QUOTED.test(written)) ||
    importCalls(text) > lazy.length;
  if (walked) walk(text, parsed.program, found, forwarding);
  else {
    for (const { at, written } of lazy) {
      const quoted = QUOTED.exec(written);
      if (quoted !== null) found.push({ specifier: quoted[2] as string, at, clause: false, loads: 'lazily', forwards: false });
    }
  }
  for (const name of forwarding.exported) {
    const at = forwarding.bound.get(name);
    if (at !== undefined) forwarding.at.add(at);
  }
  return forwarding.at.size === 0 ? found : found.map((site) => (forwarding.at.has(site.at) ? { ...site, forwards: true } : site));
}

function importCalls(text: string): number {
  let calls = 0;
  IMPORT_CALL.lastIndex = 0;
  while (IMPORT_CALL.exec(text) !== null) calls += 1;
  return calls;
}

type Node = { readonly type?: unknown; readonly [key: string]: unknown };

const literal = (node: unknown): { readonly value: string; readonly start: number } | undefined => {
  const held = node as Node | null | undefined;
  return held?.type === 'Literal' && typeof held.value === 'string' && typeof held.start === 'number'
    ? { value: held.value, start: held.start }
    : undefined;
};

const macroImport = (value: unknown): boolean => {
  const node = value as Node;
  return ((node.attributes ?? []) as readonly Node[]).some((attribute) => {
    const key = attribute.key as Node;
    return (key.type === 'Identifier' ? key.name : key.value) === 'type' && literal(attribute.value)?.value === 'macro';
  });
};

const importMeta = (value: unknown): boolean => {
  const node = value as Node | undefined;
  return node?.type === 'MetaProperty' && (node.meta as Node)?.name === 'import' && (node.property as Node)?.name === 'meta';
};

const metaMember = (value: unknown, name: string): boolean => {
  const node = value as Node | undefined;
  const property = node?.property as Node | undefined;
  return (
    node?.type === 'MemberExpression' &&
    importMeta(node.object) &&
    (node.computed === true ? property?.value === name : property?.name === name)
  );
};

const GLOB_LOAD_OPTIONS: Readonly<Record<string, 'boolean' | 'string'>> = { eager: 'boolean', import: 'string' };

const loadOnlyOptions = (value: unknown): boolean => {
  const node = value as Node | undefined;
  if (node?.type !== 'ObjectExpression') return false;
  return (node.properties as readonly Node[]).every((property) => {
    const key = property.key as Node | undefined;
    const name = key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? key.value : undefined;
    const held = property.value as Node | undefined;
    return (
      property.type === 'Property' &&
      property.computed !== true &&
      property.kind === 'init' &&
      typeof name === 'string' &&
      Object.hasOwn(GLOB_LOAD_OPTIONS, name) &&
      held?.type === 'Literal' &&
      typeof held.value === GLOB_LOAD_OPTIONS[name]
    );
  });
};

const everyTyped = (parts: readonly Node[], kind: string): boolean => parts.length > 0 && parts.every((one) => one[kind] === 'type');

const required = (node: unknown): { readonly value: string; readonly start: number } | undefined => {
  const call = node as Node | null | undefined;
  const callee = call?.callee as Node | undefined;
  return call?.type === 'CallExpression' && callee?.type === 'Identifier' && callee.name === 'require'
    ? literal((call.arguments as unknown[])[0])
    : undefined;
};

const namesOf = (pattern: unknown): readonly string[] => {
  const held = pattern as Node | null | undefined;
  switch (held?.type) {
    case 'Identifier':
      return typeof held.name === 'string' ? [held.name] : [];
    case 'ObjectPattern':
      return (held.properties as readonly Node[]).flatMap((one) => namesOf(one.type === 'RestElement' ? one.argument : one.value));
    case 'ArrayPattern':
      return (held.elements as readonly unknown[]).flatMap(namesOf);
    case 'AssignmentPattern':
      return namesOf(held.left);
    case 'RestElement':
      return namesOf(held.argument);
    default:
      return [];
  }
};

function walk(text: string, root: unknown, found: Found[], forwarding: Forwarding): void {
  const stack: [unknown, boolean][] = [[root, false]];
  while (stack.length > 0) {
    const [node, inModuleBlock] = stack.pop() as [unknown, boolean];
    if (Array.isArray(node)) {
      for (const item of node) stack.push([item, inModuleBlock]);
      continue;
    }
    if (node === null || typeof node !== 'object') continue;
    const held = node as Node;
    const take = (named: unknown, clause: boolean, loads: ImportSite['loads'], forwards = false, form: ImportSite['form'] = 'import') => {
      const source = literal(named);
      if (source !== undefined) found.push({ specifier: source.value, at: source.start, clause, loads, forwards, form });
      return source;
    };
    const unresolved = (named: unknown) => {
      const value = named as Node | undefined;
      const at = typeof value?.start === 'number' ? value.start : (held.start as number);
      const end = typeof value?.end === 'number' ? value.end : (held.end as number);
      found.push({ specifier: text.slice(at, end), at, clause: false, loads: 'lazily', forwards: false, kind: 'unresolved' });
    };
    const parts = (held.specifiers ?? []) as readonly Node[];
    if (inModuleBlock) {
      switch (held.type) {
        case 'ImportDeclaration': {
          const source = literal(held.source);
          const clause = parts.length > 0 || (source !== undefined && text.slice(held.start as number, source.start).includes('{'));
          const named = parts.every((one) => one.type === 'ImportSpecifier');
          const typeOnly = held.importKind === 'type' || (named && everyTyped(parts, 'importKind'));
          take(held.source, clause, typeOnly || macroImport(held) ? 'never' : 'with-module');
          break;
        }
        case 'ExportNamedDeclaration':
          if (parts.length > 0 || held.declaration === null) {
            take(held.source, true, held.exportKind === 'type' || everyTyped(parts, 'exportKind') ? 'never' : 'with-module', true);
          }
          break;
        case 'ExportAllDeclaration':
          take(held.source, true, held.exportKind === 'type' ? 'never' : 'with-module', true);
          break;
      }
    }
    switch (held.type) {
      case 'Program':
        for (const statement of held.body as readonly Node[]) {
          if (statement.type !== 'VariableDeclaration') continue;
          for (const declarator of statement.declarations as readonly Node[]) {
            const source = required(declarator.init);
            if (source !== undefined) for (const name of namesOf(declarator.id)) forwarding.bound.set(name, source.start);
          }
        }
        break;
      case 'CallExpression': {
        const callee = held.callee as Node | undefined;
        const args = held.arguments as unknown[];
        if (callee?.type === 'Identifier' && callee.name === 'require') {
          if (take(args[0], false, 'with-module', false, 'require') === undefined) unresolved(args[0]);
        }
        if (metaMember(callee, 'glob')) {
          if (args.length > 2 || (args.length === 2 && !loadOnlyOptions(args[1]))) {
            unresolved(args[1]);
            break;
          }
          const argument = args[0] as Node | undefined;
          const values = argument?.type === 'ArrayExpression' ? (argument.elements as unknown[]) : [argument];
          const patterns = values.map((value) => literal(value)?.value);
          if (patterns.some((pattern) => pattern === undefined)) unresolved(argument);
          else
            found.push({
              specifier: patterns.join(', '),
              patterns: patterns as string[],
              at: argument?.start as number,
              clause: false,
              loads: 'lazily',
              forwards: false,
              kind: 'glob',
            });
        }
        break;
      }
      case 'NewExpression': {
        const callee = held.callee as Node | undefined;
        if (callee?.type !== 'Identifier' || !['Worker', 'SharedWorker'].includes(callee.name as string)) break;
        const target = (held.arguments as unknown[])[0] as Node | undefined;
        const constructor = target?.callee as Node | undefined;
        const args = target?.arguments as unknown[] | undefined;
        if (
          target?.type !== 'NewExpression' ||
          constructor?.type !== 'Identifier' ||
          constructor.name !== 'URL' ||
          !metaMember(args?.[1], 'url')
        )
          break;
        const source = literal(args?.[0]);
        if (source === undefined) unresolved(args?.[0]);
        else found.push({ specifier: source.value, at: source.start, clause: false, loads: 'lazily', forwards: false, kind: 'worker' });
        break;
      }
      case 'ImportExpression':
        if (take(held.source, false, 'lazily') === undefined) unresolved(held.source);
        break;
      case 'TSImportType':
        take(held.source, false, 'never');
        break;
      case 'TSImportEqualsDeclaration': {
        const reference = held.moduleReference as Node | undefined;
        if (reference?.type !== 'TSExternalModuleReference') break;
        const source = take(reference.expression, false, held.importKind === 'type' ? 'never' : 'with-module', false, 'require');
        const id = held.id as Node | undefined;
        if (!inModuleBlock && source !== undefined && typeof id?.name === 'string') forwarding.bound.set(id.name, source.start);
        break;
      }
      case 'TSExportAssignment': {
        if (inModuleBlock) break;
        const expression = held.expression as Node | undefined;
        const source = required(expression);
        if (source !== undefined) forwarding.at.add(source.start);
        else if (expression?.type === 'Identifier' && typeof expression.name === 'string') forwarding.exported.push(expression.name);
        break;
      }
      case 'ExportNamedDeclaration':
        if (!inModuleBlock && parts.length === 0 && held.declaration === null) {
          take(held.source, true, held.exportKind === 'type' ? 'never' : 'with-module', true);
        }
        break;
    }
    const inside = inModuleBlock || held.type === 'TSModuleDeclaration';
    for (const key in held) {
      const value = held[key];
      if (value !== null && typeof value === 'object') stack.push([value, inside]);
    }
  }
}

export function linesUpTo(source: string, ascending: readonly number[]): readonly number[] {
  const lines: number[] = [];
  let line = 1;
  let from = 0;
  for (const offset of ascending) {
    for (let at = source.indexOf('\n', from); at !== -1 && at < offset; at = source.indexOf('\n', at + 1)) {
      line += 1;
      from = at + 1;
    }
    lines.push(line);
  }
  return lines;
}
