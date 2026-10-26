import type { JsonSchema } from '../../schema/ids';
import type { ToolSchemaDialect } from '../../schema/options';
import { resolveSchemaRef, schemaAlternatives, schemaLiteral, schemaProperties, schemaRequired } from '../../schema/readJsonSchema';
import { isRecord } from '../../utils/record';

const schemaRecords = (value: unknown): readonly Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const NUMBER_SENTINELS = ['Infinity', '-Infinity', 'NaN'] as const;

const isSentinelSchema = (schema: Record<string, unknown>): boolean => {
  const values = schema.enum;
  return (
    schema.type === 'string' &&
    Array.isArray(values) &&
    values.length === NUMBER_SENTINELS.length &&
    NUMBER_SENTINELS.every((value) => values.includes(value))
  );
};

const isSentinelArm = (schema: JsonSchema, root: JsonSchema): boolean => {
  if (isSentinelSchema(schema)) return true;
  const definition = resolveSchemaRef(root, schema);
  return definition !== undefined && isSentinelSchema(definition);
};

const finiteNode = (schema: unknown, root: JsonSchema): unknown => {
  if (Array.isArray(schema)) return schema.map((node) => finiteNode(node, root));
  if (!isRecord(schema)) return schema;
  const variants = schemaRecords(schema.anyOf);
  const number = variants.find((variant) => variant.type === 'number');
  if (variants.length === 2 && number !== undefined && variants.some((variant) => isSentinelArm(variant, root))) {
    const { anyOf: _, ...fields } = schema;
    return finiteNode({ ...fields, ...number }, root);
  }
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, finiteNode(value, root)]));
};

const finiteNumbers = (schema: JsonSchema): JsonSchema => {
  const projected = finiteNode(schema, schema);
  return isRecord(projected) ? projected : schema;
};

const distinctSchemas = (schemas: readonly unknown[]): readonly unknown[] => {
  const seen = new Set<string>();
  return schemas.filter((schema) => {
    const key = JSON.stringify(schema);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const alternativeProperty = (schemas: readonly unknown[]): unknown => {
  const distinct = distinctSchemas(schemas);
  if (distinct.length <= 1) return distinct[0] ?? {};
  const literals = distinct.map((schema) => (isRecord(schema) && 'const' in schema ? schema.const : undefined));
  if (literals.every((literal) => literal !== undefined)) return { enum: distinctSchemas(literals) };
  const enums = distinct.map((schema) => (isRecord(schema) && Array.isArray(schema.enum) ? schema.enum : undefined));
  if (enums.every((values) => values !== undefined)) {
    const types = distinct.map((schema) => (isRecord(schema) ? schema.type : undefined));
    const type = types[0] !== undefined && types.every((value) => value === types[0]) ? types[0] : undefined;
    return { ...(type === undefined ? {} : { type }), enum: distinctSchemas(enums.flat()) };
  }
  return { anyOf: distinct };
};

const conjunctiveProperty = (schemas: readonly unknown[]): unknown => {
  const distinct = distinctSchemas(schemas);
  return distinct.length <= 1 ? (distinct[0] ?? {}) : { allOf: distinct };
};

const mergedProperties = (
  root: Record<string, unknown>,
  conjunctions: readonly Record<string, unknown>[],
  alternatives: readonly Record<string, unknown>[],
): Record<string, unknown> => {
  const properties = new Map<string, unknown[]>();
  for (const schema of [root, ...conjunctions]) {
    for (const [name, property] of Object.entries(schemaProperties(schema))) {
      const held = properties.get(name);
      if (held) held.push(property);
      else properties.set(name, [property]);
    }
  }
  const alternativeNames = new Set(alternatives.flatMap((schema) => Object.keys(schemaProperties(schema))));
  for (const name of alternativeNames) {
    const variants = alternatives.flatMap((schema) => {
      const property = schemaProperties(schema)[name];
      return property === undefined ? [] : [property];
    });
    const projected = alternativeProperty(variants);
    const held = properties.get(name);
    if (held) held.push(projected);
    else properties.set(name, [projected]);
  }
  return Object.fromEntries([...properties].map(([name, schemas]) => [name, conjunctiveProperty(schemas)]));
};

const mergedRequired = (
  root: Record<string, unknown>,
  conjunctions: readonly Record<string, unknown>[],
  alternatives: readonly Record<string, unknown>[],
): readonly string[] => {
  const required = new Set([root, ...conjunctions].flatMap(schemaRequired));
  const common = alternatives[0]
    ? schemaRequired(alternatives[0]).filter((name) => alternatives.every((schema) => schemaRequired(schema).includes(name)))
    : [];
  for (const name of common) required.add(name);
  return [...required];
};

const taggedAlternatives = (alternatives: readonly JsonSchema[]) => {
  const first = alternatives[0];
  if (first === undefined) return undefined;
  for (const tag of schemaRequired(first)) {
    const values = alternatives.map((branch) => schemaLiteral(schemaProperties(branch)[tag]));
    if (values.some((value) => value === undefined) || new Set(values).size !== alternatives.length) continue;
    return { tag, values: values as readonly string[] };
  }
  return undefined;
};

const appendDescription = (schema: unknown, description: string): unknown => {
  if (!isRecord(schema)) return schema;
  const current = typeof schema.description === 'string' ? schema.description.trim() : '';
  if (current.endsWith(description)) return schema;
  return { ...schema, description: current.length === 0 ? description : `${current} ${description}` };
};

const describeTaggedRequirements = (
  properties: Record<string, unknown>,
  alternatives: readonly Record<string, unknown>[],
): Record<string, unknown> => {
  const tagged = taggedAlternatives(alternatives);
  if (tagged === undefined) return properties;
  const requirements = alternatives.map((branch) => schemaRequired(branch).filter((name) => name !== tagged.tag));
  const tagDescription = tagged.values
    .map((value, index) => {
      const required = requirements[index] ?? [];
      return `${tagged.tag} ${value} requires ${required.length === 0 ? 'no other keys' : required.join(' and ')}`;
    })
    .join('; ');
  const described = { ...properties };
  described[tagged.tag] = appendDescription(described[tagged.tag], `Variant requirements: ${tagDescription}.`);
  for (const name of new Set(requirements.flat())) {
    const values = tagged.values.filter((_, index) => requirements[index]?.includes(name));
    if (values.length === alternatives.length) continue;
    described[name] = appendDescription(described[name], `Required when ${tagged.tag} is ${values.join(' or ')}.`);
  }
  return described;
};

const flatRootObjectSchemas = new WeakMap<object, JsonSchema>();

const flatRootObject = (schema: JsonSchema): JsonSchema => {
  const cached = flatRootObjectSchemas.get(schema);
  if (cached !== undefined) return cached;
  const input = finiteNumbers(schema);
  const { anyOf: _anyOf, oneOf: _oneOf, allOf, ...root } = input;
  const alternatives = schemaAlternatives(input);
  const conjunctions = schemaRecords(allOf);
  if (alternatives.length === 0 && conjunctions.length === 0) {
    flatRootObjectSchemas.set(schema, input);
    return input;
  }
  const properties = describeTaggedRequirements(mergedProperties(root, conjunctions, alternatives), alternatives);
  const required = mergedRequired(root, conjunctions, alternatives);
  const closedAlternatives = alternatives.length > 0 && alternatives.every((branch) => branch.additionalProperties === false);
  const projected = {
    ...root,
    type: 'object',
    ...(Object.keys(properties).length === 0 ? {} : { properties }),
    ...(required.length === 0 ? {} : { required }),
    ...(root.additionalProperties === false || closedAlternatives ? { additionalProperties: false } : {}),
  };
  flatRootObjectSchemas.set(schema, projected);
  return projected;
};

const modelCompatibility = (schema: JsonSchema, dialect: ToolSchemaDialect | undefined): JsonSchema =>
  dialect === undefined ? schema : dialect(schema);

export const ToolSchemaProjection = {
  flatRootObject,
  modelCompatibility,
} as const;
