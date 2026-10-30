import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { HARNESSES } from '../contract/service/table.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { McpConfigFile, McpSurface } from '@runlith/tagma/adapter/harness';
import { MCP_KEY_VARIABLE } from '../../platform/contract/wire/session.js';
import type { McpDeclarationWrite } from '../../installation/contract/wire/install.js';
import { installedHere } from '../birth/installed.js';

export const MCP_SERVER_NAME = 'tagma';

type Declaration = Readonly<Record<string, unknown>>;

const declarationFor = (adapter: HarnessAdapter, surface: McpSurface, key: string, cli: readonly string[]): Declaration => {
  const argv = [...cli, 'mcp-serve', '--harness', adapter.harness];
  const environment = { [MCP_KEY_VARIABLE]: key };
  if (surface.declaration !== undefined) return surface.declaration(argv, environment);
  const [command, ...args] = argv;
  return { command, args, ...(surface.fields ?? {}), env: environment };
};

const fileOf = (repoRoot: string, file: McpConfigFile, home?: string | null): string => {
  if (file._tag === 'Project') return join(repoRoot, ...file.path.split('/'));
  if (home !== undefined) return join(home ?? join(homedir(), ...file.folder), file.file);
  const override = file.homeEnv === undefined ? undefined : process.env[file.homeEnv];
  return override !== undefined && override !== '' ? join(override, file.file) : join(homedir(), ...file.folder, file.file);
};

const ours = (standing: unknown): boolean => {
  if (standing === null || typeof standing !== 'object') return false;
  const fields = standing as Record<string, unknown>;
  const args = fields.args ?? fields.command;
  return Array.isArray(args) && args.some((word) => word === 'mcp-serve');
};

const keyOf = (standing: unknown, surface: McpSurface): string | null => {
  if (standing === null || typeof standing !== 'object') return null;
  const env = (standing as Record<string, unknown>)[surface.environment ?? 'env'];
  if (env === null || typeof env !== 'object') return null;
  const key = (env as Record<string, unknown>)[MCP_KEY_VARIABLE];
  return typeof key === 'string' && key.length > 0 ? key : null;
};

const same = (left: unknown, right: unknown): boolean => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([name, held]) => [name, sorted(held)]));
};

const parseAs = (format: McpSurface['format'], text: string): unknown => (format === 'json' ? Bun.JSONC.parse(text) : Bun.TOML.parse(text));

type Document = { readonly held: Record<string, unknown>; readonly text: string } | { readonly unreadable: string };

const read = (path: string, format: McpSurface['format']): Document => {
  if (!existsSync(path)) return { held: {}, text: '' };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
  if (text.trim().length === 0) return { held: {}, text: '' };
  try {
    const parsed = parseAs(format, text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { unreadable: 'it does not hold a table at its root' };
    }
    return { held: parsed as Record<string, unknown>, text };
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
};

const serverPath = (servers: McpSurface['servers']): readonly string[] => (typeof servers === 'string' ? [servers] : servers);

const serversIn = (held: Record<string, unknown>, servers: McpSurface['servers']): Record<string, unknown> => {
  let table = held;
  for (const name of serverPath(servers)) {
    const child = table[name];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) return {};
    table = child as Record<string, unknown>;
  }
  return table;
};

const preserved = (before: Record<string, unknown>, after: string, surface: McpSurface, intended: Declaration): string | null => {
  let parsed: unknown;
  try {
    parsed = parseAs(surface.format, after);
  } catch (error) {
    return `the document this write produced does not parse: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'the document this write produced holds no table at its root';
  }
  const held = parsed as Record<string, unknown>;
  if (!same(serversIn(held, surface.servers)[MCP_SERVER_NAME], intended)) {
    return 'the document this write produced does not carry the declaration it was given';
  }
  const withoutOurs = (document: Record<string, unknown>, path = serverPath(surface.servers)): unknown => {
    if (path.length === 0) {
      const { [MCP_SERVER_NAME]: _ours, ...rest } = document;
      return rest;
    }
    const [name, ...tail] = path;
    const child = document[name!];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) return document;
    const rest = withoutOurs(child as Record<string, unknown>, tail) as Record<string, unknown>;
    const { [name!]: _child, ...outside } = document;
    return Object.keys(rest).length === 0 ? outside : { ...outside, [name!]: rest };
  };
  return same(withoutOurs(before), withoutOurs(held)) ? null : 'this write would have moved something it did not write';
};

type Span = { readonly from: number; readonly to: number };

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

const skip = (text: string, at: number): number => {
  let index = at;
  for (;;) {
    while (index < text.length && WHITESPACE.has(text[index] as string)) index += 1;
    if (text.startsWith('//', index)) {
      const line = text.indexOf('\n', index);
      index = line < 0 ? text.length : line + 1;
      continue;
    }
    if (text.startsWith('/*', index)) {
      const close = text.indexOf('*/', index + 2);
      if (close < 0) throw new Error('this file opens a comment it never closes');
      index = close + 2;
      continue;
    }
    return index;
  }
};

const stringEnds = (text: string, at: number): number => {
  let index = at + 1;
  while (index < text.length) {
    const here = text[index] as string;
    if (here === '\\') {
      index += 2;
      continue;
    }
    if (here === '"') return index + 1;
    index += 1;
  }
  throw new Error('this file opens a string it never closes');
};

const valueEnds = (text: string, at: number): number => {
  const opens = text[at];
  if (opens === '"') return stringEnds(text, at);
  if (opens === '{' || opens === '[') {
    let depth = 0;
    let index = at;
    while (index < text.length) {
      const step = skip(text, index);
      if (step !== index) {
        index = step;
        continue;
      }
      const here = text[index] as string;
      if (here === '"') {
        index = stringEnds(text, index);
        continue;
      }
      if (here === '{' || here === '[') depth += 1;
      if (here === '}' || here === ']') {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
      index += 1;
    }
    throw new Error('this file opens a table it never closes');
  }
  let index = at;
  while (index < text.length && !',}]'.includes(text[index] as string) && !WHITESPACE.has(text[index] as string)) index += 1;
  return index;
};

type Member =
  | { readonly _tag: 'Found'; readonly value: Span }
  | { readonly _tag: 'Absent'; readonly after: number; readonly close: number; readonly empty: boolean };

const memberIn = (text: string, open: number, name: string): Member => {
  let at = skip(text, open + 1);
  let after = open + 1;
  let empty = true;
  while (at < text.length && text[at] !== '}') {
    if (text[at] === ',') {
      at = skip(text, at + 1);
      continue;
    }
    if (text[at] !== '"') throw new Error(`this file holds something at character ${at} that is not a member of a JSON table`);
    const key = text.slice(at, stringEnds(text, at));
    const colon = skip(text, at + key.length);
    if (text[colon] !== ':') throw new Error(`this file holds ${key} without a value`);
    const from = skip(text, colon + 1);
    const to = valueEnds(text, from);
    if (JSON.parse(key) === name) return { _tag: 'Found', value: { from, to } };
    empty = false;
    after = to;
    at = skip(text, to);
  }
  if (at >= text.length) throw new Error('this file opens a table it never closes');
  return { _tag: 'Absent', after, close: at, empty };
};

const unitOf = (text: string): string => /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';

const indentAt = (text: string, at: number): string => {
  const line = text.lastIndexOf('\n', at - 1) + 1;
  return /^[ \t]*/.exec(text.slice(line, at))?.[0] ?? '';
};

const written = (value: unknown, indent: string, unit: string, eol: string): string =>
  JSON.stringify(value, null, unit).split('\n').join(`${eol}${indent}`);

const placeMember = (text: string, open: number, name: string, value: unknown): string => {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const unit = unitOf(text);
  const found = memberIn(text, open, name);
  if (found._tag === 'Found') {
    const body = written(value, indentAt(text, found.value.from), unit, eol);
    return `${text.slice(0, found.value.from)}${body}${text.slice(found.value.to)}`;
  }
  const indent = `${indentAt(text, open)}${unit}`;
  const member = `"${name}": ${written(value, indent, unit, eol)}`;
  if (!found.empty) return `${text.slice(0, found.after)},${eol}${indent}${member}${text.slice(found.after)}`;
  const between = text.slice(found.after, found.close);
  const closing = between.includes('\n') ? '' : `${eol}${indentAt(text, open)}`;
  return `${text.slice(0, found.after)}${eol}${indent}${member}${closing}${text.slice(found.after)}`;
};

const renderJson = (text: string, surface: McpSurface, declaration: Declaration): string => {
  const path = serverPath(surface.servers);
  const nested = (keys: readonly string[]): unknown =>
    keys.reduceRight<unknown>((value, key) => ({ [key]: value }), { [MCP_SERVER_NAME]: declaration });
  if (text.trim().length === 0) return `${JSON.stringify(nested(path), null, 2)}\n`;
  let open = skip(text, 0);
  if (text[open] !== '{') throw new Error('this file holds no JSON table at its root');
  for (const [index, name] of path.entries()) {
    const found = memberIn(text, open, name);
    if (found._tag === 'Absent') return placeMember(text, open, name, nested(path.slice(index + 1)));
    if (text[found.value.from] !== '{')
      throw new Error(`this file holds ${path.slice(0, index + 1).join('.')} as something other than a table`);
    open = found.value.from;
  }
  return placeMember(text, open, MCP_SERVER_NAME, declaration);
};

const TOML_HEADER = /^\s*\[{1,2}\s*([^[\]]+?)\s*\]{1,2}\s*$/;

const tomlString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const tomlValue = (value: unknown): string => {
  if (typeof value === 'string') return tomlString(value);
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  throw new Error(`a declaration field of this shape cannot be written as TOML: ${JSON.stringify(value)}`);
};

const renderTomlTable = (servers: string, declaration: Declaration): string => {
  const { env, ...scalars } = declaration as Record<string, unknown> & { readonly env?: Record<string, string> };
  const lines = [`[${servers}.${MCP_SERVER_NAME}]`];
  for (const [name, value] of Object.entries(scalars)) lines.push(`${name} = ${tomlValue(value)}`);
  if (env !== undefined) {
    lines.push('', `[${servers}.${MCP_SERVER_NAME}.env]`);
    for (const [name, value] of Object.entries(env)) lines.push(`${name} = ${tomlValue(value)}`);
  }
  return lines.join('\n');
};

const renderToml = (text: string, surface: McpSurface, standing: boolean, declaration: Declaration): string => {
  const returns = text.includes('\r\n');
  const own = (line: string): string => (returns ? `${line}\r` : line);
  const blank = own('');
  const servers = serverPath(surface.servers).join('.');
  const table = renderTomlTable(servers, declaration).split('\n').map(own);
  const ownName = `${servers}.${MCP_SERVER_NAME}`;
  const lines = text.length === 0 ? [] : text.split('\n');
  const isOurs = (named: string) => named === ownName || named.startsWith(`${ownName}.`);
  const trimmed = (of: readonly string[]): string[] => {
    const kept = [...of];
    while (kept.length > 0 && (kept[kept.length - 1] as string).trim().length === 0) kept.pop();
    return kept;
  };
  const opens = lines.findIndex((line) => {
    const header = TOML_HEADER.exec(line);
    return header !== null && header[1] === ownName;
  });
  if (opens < 0 && standing) {
    throw new Error(
      `this file declares ${ownName} in a shape this installation does not edit — dotted keys, or an inline table. Write it as a [${ownName}] table, or take it out, and install again`,
    );
  }
  if (opens < 0) {
    const body = trimmed(lines);
    return `${(body.length === 0 ? table : [...body, blank, ...table]).join('\n')}\n`;
  }
  let ends = opens + 1;
  while (ends < lines.length) {
    const header = TOML_HEADER.exec(lines[ends] as string);
    if (header !== null && !isOurs(header[1] as string)) break;
    ends += 1;
  }
  while (ends > opens + 1) {
    const line = (lines[ends - 1] as string).trim();
    if (line.length !== 0 && !line.startsWith('#')) break;
    ends -= 1;
  }
  const kept = trimmed([...lines.slice(0, opens), ...table, ...lines.slice(ends)]);
  return `${kept.join('\n')}\n`;
};

const writeWhole = (path: string, text: string): void => {
  const real = existsSync(path) ? realpathSync(path) : path;
  mkdirSync(dirname(real), { recursive: true });
  const mode = existsSync(real) ? statSync(real).mode & 0o777 : null;
  const beside = `${real}.tagma-${process.pid}.tmp`;
  writeFileSync(beside, text, mode === null ? undefined : { mode });
  if (mode !== null) chmodSync(beside, mode);
  renameSync(beside, real);
};

const APPROVAL_BUDGET_MS = 20_000;

const programmed = (adapter: HarnessAdapter, argv: readonly string[]): readonly string[] =>
  argv[0] === adapter.binary ? [installedHere(adapter) ?? adapter.binary, ...argv.slice(1)] : argv;
const SAID = 400;

const approve = async (
  argv: readonly string[],
  cwd: string,
): Promise<{ readonly approved: 'taken' | 'refused'; readonly detail?: string }> => {
  try {
    const child = Bun.spawn([...argv], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: APPROVAL_BUDGET_MS });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode === 0) return { approved: 'taken' };
    const said = `${stderr}\n${stdout}`.trim();
    const first = said.split('\n', 1)[0]?.trim() ?? '';
    const ended = child.signalCode === null ? `exited ${exitCode}` : `was ended by ${child.signalCode}`;
    return {
      approved: 'refused',
      detail: `${argv[0]} ${ended}${first.length === 0 ? '' : `: ${first.slice(0, SAID)}`}`,
    };
  } catch (error) {
    return { approved: 'refused', detail: `${argv[0]} could not be run: ${error instanceof Error ? error.message : String(error)}` };
  }
};

const refused = (harness: HarnessName, path: string, detail: string): McpDeclarationWrite => ({
  harness,
  path,
  write: 'refused',
  detail,
});

export const declareInto = async (
  repoRoot: string,
  adapter: HarnessAdapter,
  surface: McpSurface,
  cli: readonly string[],
  home?: string | null,
): Promise<McpDeclarationWrite> => {
  const path = fileOf(repoRoot, surface.file, home);
  const document = read(path, surface.format);
  if ('unreadable' in document) {
    return refused(adapter.harness, path, `this file could not be read as ${surface.format}: ${document.unreadable}`);
  }
  const standing = serversIn(document.held, surface.servers)[MCP_SERVER_NAME];
  if (standing !== undefined && !ours(standing)) {
    return refused(
      adapter.harness,
      path,
      `a server named ${MCP_SERVER_NAME} already stands here and is not one Tagma wrote; rename it, or take it out, and install again`,
    );
  }
  const declaration = declarationFor(adapter, surface, keyOf(standing, surface) ?? crypto.randomUUID(), cli);
  const settled = (write: 'created' | 'updated' | 'current'): McpDeclarationWrite => ({ harness: adapter.harness, path, write });
  if (standing !== undefined && same(standing, declaration)) return settled('current');
  let text: string;
  try {
    text =
      surface.format === 'json'
        ? renderJson(document.text, surface, declaration)
        : renderToml(document.text, surface, standing !== undefined, declaration);
  } catch (error) {
    return refused(
      adapter.harness,
      path,
      `this declaration could not be written: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const damage = preserved(document.held, text, surface, declaration);
  if (damage !== null) return refused(adapter.harness, path, `${damage}, so nothing was written; this file is unchanged`);
  const existed = existsSync(path);
  try {
    writeWhole(path, text);
  } catch (error) {
    return refused(adapter.harness, path, `this file could not be written: ${error instanceof Error ? error.message : String(error)}`);
  }
  return settled(existed ? 'updated' : 'created');
};

export const declareForLaunch = async (
  repoRoot: string,
  adapter: HarnessAdapter,
  surface: McpSurface,
  cli: readonly string[],
): Promise<McpDeclarationWrite> => {
  const written = await declareInto(repoRoot, adapter, surface, cli);
  return written.write === 'refused' || surface.approve === undefined
    ? written
    : { ...written, ...(await approve(programmed(adapter, surface.approve(MCP_SERVER_NAME)), repoRoot)) };
};

export async function installMcpDeclarations(repoRoot: string, cli: readonly string[]): Promise<McpDeclarationWrite[]> {
  const written: McpDeclarationWrite[] = [];
  for (const adapter of HARNESSES) {
    if (adapter.mcp === null || installedHere(adapter) === null) continue;
    written.push(await declareInto(repoRoot, adapter, adapter.mcp, cli));
  }
  return written;
}
