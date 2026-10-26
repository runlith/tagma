import { isRecord } from '../utils/record';
import type { JsonSchema } from './ids';

export const schemaProperties = (node: JsonSchema): JsonSchema => (isRecord(node.properties) ? node.properties : {});

export const schemaRequired = (node: JsonSchema): readonly string[] =>
  Array.isArray(node.required) ? node.required.filter((name): name is string => typeof name === 'string') : [];

export const schemaAlternatives = (node: JsonSchema): readonly JsonSchema[] =>
  [...(Array.isArray(node.anyOf) ? node.anyOf : []), ...(Array.isArray(node.oneOf) ? node.oneOf : [])].filter(isRecord);

export const schemaLiteral = (node: unknown): string | undefined => {
  if (!isRecord(node)) return undefined;
  if (typeof node.const === 'string') return node.const;
  return Array.isArray(node.enum) && node.enum.length === 1 && typeof node.enum[0] === 'string' ? node.enum[0] : undefined;
};

const LOCAL_REF = /^#\/(\$defs|definitions)\/(.+)$/;

export const resolveSchemaRef = (root: JsonSchema, node: JsonSchema): JsonSchema | undefined => {
  if (typeof node.$ref !== 'string') return undefined;
  const named = LOCAL_REF.exec(node.$ref);
  if (named === null) return undefined;
  const definitions = root[named[1] as string];
  if (!isRecord(definitions)) return undefined;
  const definition = definitions[decodeURIComponent(named[2] as string)];
  return isRecord(definition) ? definition : undefined;
};

const BRANCH_DEPTH = 8;

export const schemaBranches = (root: JsonSchema, node: unknown, depth = 0): readonly JsonSchema[] => {
  if (!isRecord(node) || depth > BRANCH_DEPTH) return [];
  const referenced = resolveSchemaRef(root, node);
  if (referenced !== undefined) return schemaBranches(root, referenced, depth + 1);
  const members = schemaAlternatives(node);
  if (members.length === 0) return [node];
  return members.flatMap((member) => schemaBranches(root, member, depth + 1));
};
