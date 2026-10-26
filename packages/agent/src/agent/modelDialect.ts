import type { JsonSchema } from '@runlith/llm/schema/ids';
import { schemaBranches, schemaLiteral, schemaProperties, schemaRequired } from '@runlith/llm/schema/readJsonSchema';
import { isRecord } from '@runlith/utils/object';

export function readModelDialect(schema: JsonSchema, input: unknown): unknown | undefined {
  if (!isRecord(schema)) return undefined;
  const read = dialectValue(schema, schema, input);
  if (!isRecord(input)) return read;
  return splitLeakedParameters(schema, isRecord(read) ? read : input) ?? read;
}

const LEAKED_PARAMETER = /<\/[^<>\n]{1,64}>\s*<(?:[\w-]+:)?parameter name="([^"\n]+)">/g;

function splitLeakedParameters(root: JsonSchema, value: Record<string, unknown>): Record<string, unknown> | undefined {
  const branches = selectedBranches(schemaBranches(root, root), value);
  const properties = objectProperties(branches);
  const required = new Set(branches.flatMap(schemaRequired));
  const present = new Set(Object.keys(value));
  const read: Record<string, unknown> = {};
  let changed = false;
  for (const [key, held] of Object.entries(value)) {
    const parts = typeof held === 'string' ? held.split(LEAKED_PARAMETER) : [held];
    const names = parts.filter((_, index) => index % 2 === 1) as string[];
    const fits =
      names.some((name) => required.has(name)) &&
      new Set(names).size === names.length &&
      names.every((name) => Object.hasOwn(properties, name) && !present.has(name));
    if (!fits) {
      put(read, key, held);
      continue;
    }
    put(read, key, parts[0]);
    names.forEach((name, index) => {
      put(read, name, textValue(root, properties[name], parts[index * 2 + 2] as string));
      present.add(name);
    });
    changed = true;
  }
  return changed ? read : undefined;
}

function put(bag: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(bag, key, { value, enumerable: true, writable: true, configurable: true });
}

function selectedBranches(branches: readonly JsonSchema[], value: Record<string, unknown>): readonly JsonSchema[] {
  const objects = branches.filter((branch) => declaredTypes([branch]).has('object'));
  const selected = objects.filter((branch) =>
    Object.entries(schemaProperties(branch)).every(([name, schema]) => {
      const literal = schemaLiteral(schema);
      return literal === undefined || !Object.hasOwn(value, name) || value[name] === literal;
    }),
  );
  return selected.length > 0 ? selected : objects;
}

function textValue(root: JsonSchema, schema: unknown, text: string): unknown {
  if (declaredTypes(schemaBranches(root, schema)).has('string')) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function objectProperties(branches: readonly JsonSchema[]): Record<string, unknown> {
  const properties: Record<string, unknown> = Object.create(null);
  for (const branch of branches) {
    if (!declaredTypes([branch]).has('object')) continue;
    for (const [name, schema] of Object.entries(schemaProperties(branch))) properties[name] ??= schema;
  }
  return properties;
}

function dialectValue(root: JsonSchema, schema: unknown, value: unknown): unknown | undefined {
  const branches = schemaBranches(root, schema);
  const declared = declaredTypes(branches);
  if (declared.has('array') && !Array.isArray(value) && !admitsValue(declared, value)) {
    const parsed = typeof value === 'string' ? textValue(root, schema, value) : value;
    if (Array.isArray(parsed)) return dialectArray(root, branches, parsed) ?? parsed;
    const element = dialectValue(root, branchItems(branches), value);
    return [element === undefined ? value : element];
  }
  if (Array.isArray(value)) return dialectArray(root, branches, value);
  if (isRecord(value)) return dialectObject(root, branches, value);
  return dialectScalar(declared, value);
}

function dialectArray(root: JsonSchema, branches: readonly JsonSchema[], value: readonly unknown[]): unknown | undefined {
  const items = branchItems(branches);
  if (items === undefined) return undefined;
  let changed = false;
  const read = value.map((element) => {
    const repaired = dialectValue(root, items, element);
    if (repaired === undefined) return element;
    changed = true;
    return repaired;
  });
  return changed ? read : undefined;
}

function dialectObject(root: JsonSchema, branches: readonly JsonSchema[], value: Record<string, unknown>): unknown | undefined {
  const properties = objectProperties(selectedBranches(branches, value));
  const spellings = new Map<string, string | null>();
  for (const name of Object.keys(properties)) spellings.set(spelling(name), spellings.has(spelling(name)) ? null : name);
  if (spellings.size === 0) return undefined;
  let changed = false;
  const read: Record<string, unknown> = {};
  for (const [key, held] of Object.entries(value)) {
    const spelled = Object.hasOwn(properties, key) ? null : spellings.get(spelling(key));
    const name = spelled === undefined || spelled === null || Object.hasOwn(value, spelled) || Object.hasOwn(read, spelled) ? key : spelled;
    const repaired = dialectValue(root, properties[name], held);
    if (repaired !== undefined || name !== key) changed = true;
    put(read, name, repaired === undefined ? held : repaired);
  }
  return changed ? read : undefined;
}

const spelling = (key: string) => key.replace(/[\s_-]/g, '').toLowerCase();

const QUOTED_BOOLEANS = new Map([
  ['true', true],
  ['false', false],
  ['True', true],
  ['False', false],
]);

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function dialectScalar(declared: ReadonlySet<string>, value: unknown): unknown | undefined {
  if (typeof value !== 'string' || declared.has('string')) return undefined;
  if (declared.has('number') || declared.has('integer')) {
    if (!JSON_NUMBER.test(value)) return undefined;
    const number = Number(value);
    if (!Number.isFinite(number)) return undefined;
    return declared.has('number') || Number.isInteger(number) ? number : undefined;
  }
  return declared.has('boolean') ? QUOTED_BOOLEANS.get(value) : undefined;
}

function declaredTypes(branches: readonly JsonSchema[]): ReadonlySet<string> {
  const types = new Set<string>();
  for (const branch of branches) {
    const declared = branch.type;
    if (typeof declared === 'string') types.add(declared);
    else if (Array.isArray(declared)) for (const one of declared) if (typeof one === 'string') types.add(one);
  }
  return types;
}

function admitsValue(declared: ReadonlySet<string>, value: unknown): boolean {
  if (value === null) return declared.has('null');
  if (typeof value === 'string') return declared.has('string');
  if (typeof value === 'boolean') return declared.has('boolean');
  if (typeof value === 'number') return declared.has('number') || declared.has('integer');
  return declared.has('object');
}

function branchItems(branches: readonly JsonSchema[]): JsonSchema | undefined {
  for (const branch of branches) if (isRecord(branch.items)) return branch.items;
  return undefined;
}
