import type { JsonSchema } from '@runlith/llm/schema/ids';
import { resolveSchemaRef, schemaAlternatives, schemaLiteral, schemaProperties, schemaRequired } from '@runlith/llm/schema/readJsonSchema';
import { Data, Effect, Exit, Result, Schema, SchemaIssue } from 'effect';
import { jsonCodec } from '@runlith/utils/codec';
import { toJson } from '@runlith/utils/json';
import { isRecord, type StructuredValue } from '@runlith/utils/object';
import { refusalLines } from '../tool/refusal';
import { readModelDialect } from './modelDialect';
import { type Tool, type ToolRefusal, toolFieldNames, withoutDoorFields } from './tool';

export class ToolArgumentsInvalid extends Data.TaggedError('Tool.ArgumentsInvalid')<{
  readonly tool: string;
  readonly detail: string;
  readonly arrived?: readonly string[] | undefined;
  readonly argument?: string | undefined;
  readonly expected?: string | undefined;
  readonly sent?: string | undefined;
  readonly sibling?: string | undefined;
  readonly code: 'body-shape';
  readonly unblock?: readonly string[] | undefined;
  readonly unrevealed?: { readonly note: string; readonly schema: JsonSchema } | undefined;
}> {
  revealing(unrevealed: { readonly note: string; readonly schema: JsonSchema }): ToolArgumentsInvalid {
    const { tool, detail, arrived, argument, expected, sent, sibling, code, unblock } = this;
    return new ToolArgumentsInvalid({ tool, detail, arrived, argument, expected, sent, sibling, code, unblock, unrevealed });
  }

  get refusal(): ToolRefusal {
    return { code: this.code, reason: this.message, words: 'Input not accepted' };
  }

  get output(): StructuredValue {
    return toJson({
      status: 'refused',
      code: this.code,
      reason: this.message,
      argument: this.argument,
      expected: this.expected,
      sent: this.sent,
      sibling: this.sibling,
      unblock: this.unblock,
      schema: this.unrevealed?.schema,
    });
  }

  override get message(): string {
    return [this.said, ...(this.unblock ?? []).map((way) => `unblock: ${way}`), ...this.note].join('\n');
  }

  get text(): string {
    const schema = this.unrevealed === undefined ? [] : [`schema: ${JSON.stringify(this.unrevealed.schema)}`];
    return [...refusalLines({ code: this.code, reason: this.said, unblock: this.unblock ?? [] }), ...this.note, ...schema].join('\n');
  }

  private get said(): string {
    const carried = this.arrived === undefined || this.arrived.length === 0 ? '' : ` The call carried: ${this.arrived.join(', ')}.`;
    return `The ${this.tool} tool was called with invalid arguments: ${this.detail}.${carried} Rewrite the input so it satisfies the schema.`;
  }

  private get note(): readonly string[] {
    return this.unrevealed === undefined ? [] : [this.unrevealed.note];
  }
}

type ArgumentCatalog = ReadonlyMap<string, Tool> | (() => ReadonlyMap<string, Tool>);

export const toolDecode = (source: Tool, input: unknown) =>
  Schema.decodeUnknownEffect(jsonCodec(source.parameters))(input, source.parseOptions);

export function toolArguments(
  source: Tool,
  name: string,
  rawInput: unknown,
  catalog?: ArgumentCatalog,
): Effect.Effect<unknown, ToolArgumentsInvalid> {
  const input = withoutDoorFields(rawInput, source.doorFields ?? []);
  const arrived = isRecord(input) ? Object.keys(input) : [];
  const invalid = checkArguments(source, name, input, arrived, typeof catalog === 'function' ? catalog : () => catalog);
  if (invalid !== null) {
    const dialect = dialectKeys(source, name, input);
    if (dialect === undefined) return Effect.fail(invalid);
    return toolDecode(source, dialect).pipe(Effect.mapError(() => invalid));
  }
  return toolDecode(source, input).pipe(
    Effect.catch((error) => {
      const refusal = () => decodeRefusal(source, name, input, arrived, error);
      const dialect = readModelDialect(source.inputSchema, input);
      if (dialect === undefined) return Effect.fail(refusal());
      return toolDecode(source, dialect).pipe(Effect.mapError(refusal));
    }),
  );
}

export function toolArgumentsResult<A>(
  source: Tool & { readonly parameters: Schema.Codec<A, unknown> },
  name: string,
  rawInput: unknown,
  catalog?: ArgumentCatalog,
): Result.Result<A, ToolArgumentsInvalid> {
  const input = withoutDoorFields(rawInput, source.doorFields ?? []);
  const arrived = isRecord(input) ? Object.keys(input) : [];
  const invalid = checkArguments(source, name, input, arrived, typeof catalog === 'function' ? catalog : () => catalog);
  const decode = Schema.decodeUnknownResult(jsonCodec(source.parameters));
  if (invalid !== null) {
    const dialect = dialectKeys(source, name, input);
    return dialect === undefined ? Result.fail(invalid) : Result.mapError(decode(dialect, source.parseOptions), () => invalid);
  }
  const parsed = decode(input, source.parseOptions);
  if (Result.isSuccess(parsed)) return Result.succeed(parsed.success);
  const refusal = () => decodeRefusal(source, name, input, arrived, parsed.failure);
  const dialect = readModelDialect(source.inputSchema, input);
  if (dialect === undefined) return Result.fail(refusal());
  return Result.mapError(decode(dialect, source.parseOptions), refusal);
}

function checkArguments(
  source: Tool,
  name: string,
  input: unknown,
  arrived: readonly string[],
  catalog: (() => ReadonlyMap<string, Tool> | undefined) | undefined,
): ToolArgumentsInvalid | null {
  const refuse = (detail: string, sibling: string | undefined) =>
    new ToolArgumentsInvalid({ tool: name, detail, arrived, sibling: sibling, code: 'body-shape' });
  const declared = source.inputRefusal === undefined ? toolFieldNames(source) : null;
  if (declared !== null) {
    const unknown = arrived.filter((key) => !declared.has(key));
    if (unknown.length > 0) {
      const takes = declared.size === 0 ? 'this tool takes no arguments' : `this tool takes ${[...declared].join(', ')}`;
      const named = `unknown argument${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}; ${takes}`;
      const nested = nestedFieldOwner(source, unknown);
      const sibling = nested === undefined ? siblingAccepting(name, input, arrived, catalog?.()) : undefined;
      const owner =
        nested ??
        (sibling === undefined
          ? undefined
          : `${joinedNames(unknown)} ${unknown.length > 1 ? 'are arguments' : 'is an argument'} of ${sibling}, which takes this call as written; call that tool`);
      return refuse(owner === undefined ? named : `${named}. ${owner}`, sibling);
    }
  }
  return null;
}

function dialectKeys(source: Tool, name: string, input: unknown): unknown | undefined {
  const dialect = readModelDialect(source.inputSchema, input);
  if (!isRecord(dialect)) return undefined;
  return checkArguments(source, name, dialect, Object.keys(dialect), undefined) === null ? dialect : undefined;
}

function decodeRefusal(
  source: Tool,
  name: string,
  input: unknown,
  arrived: readonly string[],
  error: Schema.SchemaError,
): ToolArgumentsInvalid {
  if (source.inputRefusal !== undefined)
    return new ToolArgumentsInvalid({ tool: name, arrived, code: 'body-shape', ...source.inputRefusal(error) });
  const variant = toolDecodeDetail(source, input);
  if (variant !== undefined) {
    return new ToolArgumentsInvalid({ tool: name, detail: variant, arrived, code: 'body-shape' });
  }
  const fault = toolArgumentFault(error.issue, input);
  return new ToolArgumentsInvalid({
    tool: name,
    detail: toolFaultDetail(fault),
    arrived,
    ...fault,
    code: 'body-shape',
  });
}

function nestedFieldOwner(source: Tool, unknown: readonly string[]): string | undefined {
  const root = source.inputSchema;
  if (!isRecord(root)) return undefined;
  const fields = Object.entries(schemaProperties(root));
  const owners = new Map<string, string[]>();
  for (const key of unknown) {
    const declaring = fields.filter(([, nested]) => schemaObjectFields(root, nested)?.[key] !== undefined);
    const only = declaring.length === 1 ? declaring[0]?.[0] : undefined;
    if (only === undefined) continue;
    const held = owners.get(only);
    if (held === undefined) owners.set(only, [key]);
    else held.push(key);
  }
  if (owners.size === 0) return undefined;
  return [...owners].map(([owner, keys]) => `${joinedNames(keys)} ${keys.length > 1 ? 'are fields' : 'is a field'} of ${owner}`).join('; ');
}

function siblingAccepting(
  name: string,
  input: unknown,
  arrived: readonly string[],
  catalog: ReadonlyMap<string, Tool> | undefined,
): string | undefined {
  if (catalog === undefined) return undefined;
  let found: string | undefined;
  for (const [candidate, tool] of catalog) {
    if (candidate === name) continue;
    const fields = toolFieldNames(tool);
    if (fields === null || !arrived.every((key) => fields.has(key)) || !toolAccepts(tool, input)) continue;
    if (found !== undefined) return undefined;
    found = candidate;
  }
  return found;
}

function toolAccepts(source: Tool, input: unknown): boolean {
  const decode = Schema.decodeUnknownExit(jsonCodec(source.parameters));
  if (Exit.isSuccess(decode(input, source.parseOptions))) return true;
  const dialect = readModelDialect(source.inputSchema, input);
  return dialect !== undefined && Exit.isSuccess(decode(dialect, source.parseOptions));
}

function joinedNames(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function schemaObjectFields(root: JsonSchema, schema: unknown, depth = 0): JsonSchema | undefined {
  if (!isRecord(schema) || depth > 4) return undefined;
  const referenced = resolveSchemaRef(root, schema);
  if (referenced !== undefined) return schemaObjectFields(root, referenced, depth + 1);
  if (schema.type === 'object') return schemaProperties(schema);
  for (const member of schemaAlternatives(schema)) {
    const fields = schemaObjectFields(root, member, depth + 1);
    if (fields !== undefined) return fields;
  }
  return undefined;
}

type ToolArgumentFault = {
  readonly argument: string;
  readonly expected: string | undefined;
  readonly sent: string | undefined;
};

function toolFaultDetail(fault: ToolArgumentFault): string {
  const head = fault.expected === undefined ? `${fault.argument} is required` : `${fault.argument} expects ${fault.expected}`;
  return fault.sent === undefined ? `${head}, and the call sent nothing there` : `${head}; the call sent ${fault.sent}`;
}

const ARRIVED_VALUE_CAP = 80;

const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

function toolArgumentFault(issue: SchemaIssue.Issue, input: unknown): ToolArgumentFault {
  const path: PropertyKey[] = [];
  let node = issue;
  for (;;) {
    if (node._tag === 'Pointer') {
      path.push(...node.path);
      node = node.issue;
      continue;
    }
    if (node._tag === 'Composite' || node._tag === 'AnyOf') {
      const first = node.issues[0];
      if (first === undefined) break;
      node = first;
      continue;
    }
    if ((node._tag === 'Encoding' || node._tag === 'Filter') && issueCarriesPath(node.issue)) {
      node = node.issue;
      continue;
    }
    break;
  }
  const argument = path.length === 0 ? 'input' : formatArgumentPath(path);
  if (node._tag === 'MissingKey') return { argument, expected: undefined, sent: undefined };
  const carried = argumentAt(input, path);
  return {
    argument,
    expected: issueExpectation(node),
    sent: carried.present ? renderArrivedValue(carried.value) : undefined,
  };
}

function issueCarriesPath(issue: SchemaIssue.Issue): boolean {
  switch (issue._tag) {
    case 'Pointer':
    case 'Composite':
      return true;
    case 'AnyOf':
      return issue.issues.length > 0;
    case 'Encoding':
    case 'Filter':
      return issueCarriesPath(issue.issue);
    default:
      return false;
  }
}

function issueExpectation(node: SchemaIssue.Issue): string {
  if (node._tag === 'AnyOf' && node.issues.length === 0) {
    const members = node.ast.types.filter((type) => type._tag !== 'Undefined');
    const only = members.length === 1 ? members[0] : undefined;
    if (only !== undefined) return expectationPhrase(formatSchemaIssue(new SchemaIssue.InvalidType(only)));
  }
  return expectationPhrase(formatSchemaIssue(node));
}

const EXPECTED_PHRASE = /^Expected (.+)$/s;
const BARE_TYPE_NAME = /^[a-z]+$/;

function expectationPhrase(rendered: string): string {
  const phrase = EXPECTED_PHRASE.exec(rendered)?.[1];
  if (phrase === undefined) return rendered;
  if (!BARE_TYPE_NAME.test(phrase)) return phrase;
  return `${'aeiou'.includes(phrase[0] ?? '') ? 'an' : 'a'} ${phrase}`;
}

function formatArgumentPath(path: readonly PropertyKey[]): string {
  return path.map((key, index) => (typeof key === 'number' ? `[${key}]` : index === 0 ? String(key) : `.${String(key)}`)).join('');
}

function argumentAt(input: unknown, path: readonly PropertyKey[]): { present: boolean; value: unknown } {
  let node: unknown = input;
  for (const key of path) {
    const reached = typeof node === 'object' && node !== null && Object.hasOwn(node, key);
    if (!reached) return { present: false, value: undefined };
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return { present: true, value: node };
}

function renderArrivedValue(value: unknown): string {
  const json = renderJson(value);
  const capped = json.length > ARRIVED_VALUE_CAP ? `${json.slice(0, ARRIVED_VALUE_CAP)}…` : json;
  return typeof value === 'string' ? `the string ${capped}` : capped;
}

function renderJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const schemaDescription = (schema: unknown): string | undefined => {
  if (!isRecord(schema)) return undefined;
  if (typeof schema.description === 'string') return schema.description;
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (!Array.isArray(schema[key])) continue;
    for (const member of schema[key]) {
      const description = schemaDescription(member);
      if (description !== undefined) return description;
    }
  }
  return undefined;
};

export function toolDecodeDetail(source: Tool, input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const root = source.inputSchema;
  if (!isRecord(root)) return undefined;
  const alternatives = schemaAlternatives(root);
  const first = alternatives[0];
  if (first === undefined) return undefined;
  for (const tag of schemaRequired(first)) {
    const selected = typeof input[tag] === 'string' ? input[tag] : undefined;
    if (selected === undefined) continue;
    const branch = alternatives.find((candidate) => schemaLiteral(schemaProperties(candidate)[tag]) === selected);
    if (branch === undefined) continue;
    const missing = schemaRequired(branch).filter((name) => name !== tag && !(name in input));
    if (missing.length === 0) return undefined;
    const requirement = `${tag} ${selected} requires ${missing.join(' and ')}`;
    const explanations = missing.flatMap((name) => {
      const description = schemaDescription(schemaProperties(branch)[name]);
      return description === undefined ? [] : [`${name}: ${description}`];
    });
    return explanations.length === 0 ? requirement : `${requirement}. ${explanations.join(' ').replace(/[.!?]+$/, '')}`;
  }
  return undefined;
}
