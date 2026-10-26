import type { ToolSchemaDialect } from '../../schema/options';
import { isRecord } from '../../utils/record';

const SCHEMA_INTENT_KEYS = [
  'type',
  'properties',
  'items',
  'prefixItems',
  'enum',
  'const',
  '$ref',
  'additionalProperties',
  'patternProperties',
  'required',
  'not',
  'if',
  'then',
  'else',
];

const hasCombiner = (schema: unknown) =>
  isRecord(schema) && (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf) || Array.isArray(schema.allOf));

const hasSchemaIntent = (schema: unknown) => isRecord(schema) && (hasCombiner(schema) || SCHEMA_INTENT_KEYS.some((key) => key in schema));

const sanitizeNode = (schema: unknown): unknown => {
  if (!isRecord(schema)) return Array.isArray(schema) ? schema.map(sanitizeNode) : schema;

  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, key === 'enum' && Array.isArray(value) ? value.map(String) : sanitizeNode(value)]),
  );

  if (Array.isArray(result.enum) && (result.type === 'integer' || result.type === 'number')) result.type = 'string';

  const properties = result.properties;
  if (result.type === 'object' && isRecord(properties) && Array.isArray(result.required)) {
    result.required = result.required.filter((field) => typeof field === 'string' && field in properties);
  }

  if (result.type === 'array' && !hasCombiner(result)) {
    result.items = result.items ?? {};
    if (isRecord(result.items) && !hasSchemaIntent(result.items)) result.items = { ...result.items, type: 'string' };
  }

  if (typeof result.type === 'string' && result.type !== 'object' && !hasCombiner(result)) {
    delete result.properties;
    delete result.required;
  }

  return result;
};

const emptyObjectSchema = (schema: Record<string, unknown>) =>
  schema.type === 'object' &&
  (!isRecord(schema.properties) || Object.keys(schema.properties).length === 0) &&
  !schema.additionalProperties &&
  !hasCombiner(schema);

const mergeAllOf = (schema: Record<string, unknown>): Record<string, unknown> => {
  if (!Array.isArray(schema.allOf)) return schema;
  const { allOf, ...rest } = schema;
  const members = [...allOf.filter(isRecord).map(mergeAllOf), rest];
  const properties = Object.assign({}, ...members.map((member) => (isRecord(member.properties) ? member.properties : {})));
  const required = [...new Set(members.flatMap((member) => (Array.isArray(member.required) ? member.required : [])))];
  return {
    ...Object.assign({}, ...members),
    properties: Object.keys(properties).length === 0 ? undefined : properties,
    required: required.length === 0 ? undefined : required,
  };
};

const projectNode = (input: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(input)) return undefined;
  const schema = mergeAllOf(input);
  if (emptyObjectSchema(schema)) return undefined;
  const union = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : undefined;
  return Object.fromEntries(
    [
      ['description', schema.description],
      ['required', schema.required],
      ['format', schema.format],
      ['type', Array.isArray(schema.type) ? schema.type.filter((type) => type !== 'null')[0] : schema.type],
      ['nullable', Array.isArray(schema.type) && schema.type.includes('null') ? true : undefined],
      ['enum', schema.const !== undefined ? [schema.const] : schema.enum],
      [
        'properties',
        isRecord(schema.properties)
          ? Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, projectNode(value)]))
          : undefined,
      ],
      [
        'items',
        Array.isArray(schema.items) ? schema.items.map(projectNode) : schema.items === undefined ? undefined : projectNode(schema.items),
      ],
      ['anyOf', union?.map(projectNode)],
      ['minLength', schema.minLength],
    ].filter((entry) => entry[1] !== undefined),
  );
};

export const convert = (schema: unknown) => projectNode(sanitizeNode(schema));

export const dialect: ToolSchemaDialect = (schema) => convert(schema) ?? {};
