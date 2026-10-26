import { ToolSchemaProjection } from '@runlith/llm/protocols/utils/tool-schema';
import type { JsonSchema } from '@runlith/llm/schema/ids';
import type { ToolSchemaDialect } from '@runlith/llm/schema/options';
import { resolveSchemaRef } from '@runlith/llm/schema/readJsonSchema';
import { isRecord } from '@runlith/llm/utils/record';

const MUSE_SCHEMA_NESTING = 10;

const NESTING_KEYS = new Set(['properties', 'patternProperties', 'items', 'prefixItems', 'additionalProperties', 'contains']);
const ALTERNATIVE_KEYS = new Set(['anyOf', 'oneOf', 'allOf']);
const DEFINITION_KEYS = ['$defs', 'definitions'] as const;

const childSchemas = (key: string, value: unknown): readonly unknown[] => {
  if (key === 'properties' || key === 'patternProperties') return isRecord(value) ? Object.values(value) : [];
  if (Array.isArray(value)) return value;
  return isRecord(value) ? [value] : [];
};

const deepestReach = (root: JsonSchema): ReadonlyMap<JsonSchema, number> => {
  const reach = new Map<JsonSchema, number>();
  const visit = (node: unknown, depth: number): void => {
    if (!isRecord(node)) return;
    const definition = resolveSchemaRef(root, node);
    if (definition !== undefined && depth > (reach.get(definition) ?? -1)) {
      reach.set(definition, depth);
      visit(definition, depth);
    }
    for (const [key, value] of Object.entries(node)) {
      if (ALTERNATIVE_KEYS.has(key)) for (const member of childSchemas(key, value)) visit(member, depth);
      else if (NESTING_KEYS.has(key) && depth < MUSE_SCHEMA_NESTING) for (const child of childSchemas(key, value)) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return reach;
};

const truncated = (node: unknown, depth: number): unknown => {
  if (!isRecord(node)) return node;
  return Object.fromEntries(
    Object.entries(node).flatMap(([key, value]) => {
      if (ALTERNATIVE_KEYS.has(key) && Array.isArray(value)) return [[key, value.map((member) => truncated(member, depth))]];
      if (!NESTING_KEYS.has(key) || typeof value === 'boolean') return [[key, value]];
      if (depth >= MUSE_SCHEMA_NESTING) return [];
      const nested = (child: unknown) => truncated(child, depth + 1);
      if (key === 'properties' || key === 'patternProperties') {
        return isRecord(value)
          ? [[key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, nested(child)]))]]
          : [[key, value]];
      }
      return [[key, Array.isArray(value) ? value.map(nested) : nested(value)]];
    }),
  );
};

const withinNesting = (root: JsonSchema): JsonSchema => {
  const reach = deepestReach(root);
  const definitions = DEFINITION_KEYS.flatMap((key) => {
    const carried = root[key];
    if (!isRecord(carried)) return [];
    const cut = Object.entries(carried).map(([name, definition]) => {
      const depth = isRecord(definition) ? reach.get(definition) : undefined;
      return [name, depth === undefined ? definition : truncated(definition, depth)];
    });
    return [[key, Object.fromEntries(cut)]];
  });
  return { ...(truncated(root, 0) as JsonSchema), ...Object.fromEntries(definitions) };
};

const museToolSchemas = new WeakMap<object, JsonSchema>();

export const museToolSchema: ToolSchemaDialect = (schema) => {
  const held = museToolSchemas.get(schema);
  if (held !== undefined) return held;
  const projected = withinNesting(ToolSchemaProjection.flatRootObject(schema));
  museToolSchemas.set(schema, projected);
  return projected;
};
