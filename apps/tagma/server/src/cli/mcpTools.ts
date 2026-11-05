import { jsonCodec } from '@runlith/utils/codec';
import { Schema } from 'effect';
import type { McpServedTool } from '@runlith/mcp/server';
import { DOOR_FIELDS, doorAsked, offeringDoorFields, withoutDoorFields } from '@runlith/agent/tool';
import { operationText, operationWrites, type Operation } from '../platform/contract/wire/operation.js';
import { refusalBody, type RefusalBody } from '../platform/contract/wire/refusal.js';
import type { McpToolShape } from '@runlith/tagma/adapter/harness';
import type { OperationsCli } from './contract/service/operations.js';
import { inputParsing, inputRefusal } from '../invocation/contract/service/input.js';

export const LIST_OPERATIONS = 'list_operations';
export const CALL_OPERATION = 'call_operation';

export type McpRouted =
  | {
      readonly _tag: 'Operation';
      readonly name: string;
      readonly input: unknown;
      readonly json: boolean;
      readonly project?: string | number;
    }
  | { readonly _tag: 'Answer'; readonly value: unknown; readonly text: string | undefined }
  | { readonly _tag: 'Refused'; readonly refusal: RefusalBody; readonly json: boolean };

type JsonNode = {
  readonly type?: unknown;
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly items?: unknown;
  readonly anyOf?: readonly unknown[];
  readonly oneOf?: readonly unknown[];
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly $ref?: string;
};

const typeOf = (node: unknown): string => {
  if (typeof node !== 'object' || node === null) return 'any';
  const shaped = node as JsonNode;
  if (shaped.const !== undefined) return JSON.stringify(shaped.const);
  if (shaped.enum !== undefined) return shaped.enum.map((value) => JSON.stringify(value)).join('|');
  const union = shaped.anyOf ?? shaped.oneOf;
  if (union !== undefined) return union.map(typeOf).join('|');
  if (shaped.$ref !== undefined) return shaped.$ref.split('/').at(-1) ?? 'any';
  if (shaped.type === 'array') return `${typeOf(shaped.items)}[]`;
  if (shaped.type === 'object') return shaped.properties === undefined ? 'object' : `{${fieldsOf(shaped)}}`;
  if (Array.isArray(shaped.type)) return shaped.type.join('|');
  return typeof shaped.type === 'string' ? shaped.type : 'any';
};

const fieldsOf = (node: JsonNode): string =>
  Object.entries(node.properties ?? {})
    .filter(([field]) => !(DOOR_FIELDS as readonly string[]).includes(field))
    .map(([field, type]) => `${field}${node.required?.includes(field) === true ? '' : '?'}: ${typeOf(type)}`)
    .join(', ');

const hintsOf = (entry: Operation) =>
  operationWrites(entry) ? { readOnlyHint: false, destructiveHint: entry.intent === 'destructive' } : { readOnlyHint: true };

const listSchema = Schema.Struct({
  match: Schema.optional(Schema.String.annotate({ description: 'Answer only the operations whose id contains this text.' })),
});

const callSchema = Schema.Struct({
  operation: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: `The operation id, as ${LIST_OPERATIONS} spells it.`,
  }),
  input: Schema.optional(Schema.Unknown.annotate({ description: 'That operation’s own input document; omitted means {}.' })),
  project: Schema.optional(Schema.Union([Schema.String, Schema.Int.check(Schema.isGreaterThan(0))])).annotate({
    description: 'The registered project name or id where this operation acts.',
  }),
});

const decodeList = Schema.decodeUnknownResult(jsonCodec(listSchema));
const decodeCall = Schema.decodeUnknownResult(jsonCodec(callSchema));

const refusedInput = (error: Schema.SchemaError, json: boolean): McpRouted => {
  const gate = inputRefusal(error);
  return { _tag: 'Refused', refusal: refusalBody(gate), json };
};

const unknownTool = (tool: string, shape: McpToolShape): RefusalBody => ({
  code: 'unknown-tool',
  reason: `this server serves no tool named ${tool}`,
  unblock:
    shape === 'proxy'
      ? [`${LIST_OPERATIONS} — read what this Tagma performs`, `${CALL_OPERATION} — perform one of them`]
      : ['list this server’s tools again: its catalog is the operations this Tagma performs'],
});

const unknownOperation = (named: unknown): RefusalBody => ({
  code: 'operation-unknown',
  reason:
    typeof named === 'string' && named.length > 0
      ? `\`operation\` names ${named}, which this Tagma does not perform`
      : '`operation` must name one operation id',
  unblock: [`${LIST_OPERATIONS} — read the ids this Tagma performs`],
});

export const mcpCatalog = <Id extends string>({
  registry,
  inputSchema,
  operationSchema,
  toolSchema,
}: Pick<OperationsCli<Id>, 'registry' | 'inputSchema' | 'operationSchema' | 'toolSchema'>) => {
  const served: readonly Id[] = registry.ids.filter((id) => registry.doors(id).includes('mcp'));
  const routable = (name: string): boolean => {
    const id = registry.named(name);
    return id !== null && served.includes(id);
  };
  const toolOf = (id: Id): McpServedTool => {
    const entry = registry.entry(id);
    return { name: id, description: operationText(entry), inputSchema: toolSchema(entry), annotations: hintsOf(entry) };
  };
  const listedOf = (id: Id) => {
    const entry = registry.entry(id);
    return { id, description: operationText(entry), inputSchema: operationSchema(entry) };
  };
  const listedLine = (id: Id): string => {
    const entry = registry.entry(id);
    return `${id} — ${entry.meaning}\n  input: ${typeOf(operationSchema(entry))}`;
  };
  const listInput = inputSchema(listSchema);
  const pair: readonly McpServedTool[] = [
    {
      name: LIST_OPERATIONS,
      description: `The operations this Tagma currently offers here, with what each is and the input it takes. Narrow it with \`match\`, then perform one with ${CALL_OPERATION}.`,
      inputSchema: offeringDoorFields(listInput, ['json']) ?? listInput,
      annotations: { readOnlyHint: true },
    },
    {
      name: CALL_OPERATION,
      description: `Perform one operation of this Tagma. \`operation\` is an id ${LIST_OPERATIONS} answered with, and \`input\` is that operation’s own document. What the call may do is judged per OPERATION, so performing one grants nothing to the next.`,
      inputSchema: inputSchema(callSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
  ];
  let catalog: readonly McpServedTool[] | null = null;
  const enabled = (id: Id, disabled: ReadonlySet<string>) => !disabled.has(registry.entry(id).tool?.capability ?? '');
  const tools = (shape: McpToolShape, disabled: ReadonlySet<string> = new Set()): readonly McpServedTool[] => {
    if (shape === 'proxy') return pair;
    return (catalog ??= served.map(toolOf)).filter((tool) => enabled(tool.name as Id, disabled));
  };
  const route = (
    shape: McpToolShape,
    tool: string,
    input: Record<string, unknown>,
    disabled: ReadonlySet<string> = new Set(),
  ): McpRouted => {
    if (shape === 'catalog') {
      const json = doorAsked(input, 'json') === true;
      return routable(tool) ? { _tag: 'Operation', name: tool, input, json } : { _tag: 'Refused', refusal: unknownTool(tool, shape), json };
    }
    if (tool === LIST_OPERATIONS) {
      const json = doorAsked(input, 'json') === true;
      const decoded = decodeList(withoutDoorFields(input, ['json']), inputParsing);
      if (decoded._tag === 'Failure') return refusedInput(decoded.failure, json);
      const match = decoded.success.match;
      const matched = served.filter((id) => enabled(id, disabled) && (match === undefined || id.includes(match)));
      return {
        _tag: 'Answer',
        value: { operations: matched.map(listedOf) },
        text: json ? undefined : matched.length === 0 ? 'no operation matches' : matched.map(listedLine).join('\n'),
      };
    }
    if (tool !== CALL_OPERATION) return { _tag: 'Refused', refusal: unknownTool(tool, shape), json: doorAsked(input, 'json') === true };
    const json = doorAsked(input.input, 'json') === true;
    const decoded = decodeCall(input, inputParsing);
    if (decoded._tag === 'Failure') return refusedInput(decoded.failure, json);
    const request = decoded.success;
    if (!routable(request.operation)) return { _tag: 'Refused', refusal: unknownOperation(request.operation), json };
    return { _tag: 'Operation', name: request.operation, input: request.input ?? {}, json, project: request.project };
  };
  return { tools, route };
};
