import { type Schema, SchemaAST } from 'effect';
import { isSubject, PLACE_ROLE, type FieldRole, type SubjectKind } from './place.js';

export type InputField = {
  readonly path: string;
  readonly name: string;
  readonly role: FieldRole | undefined;
  readonly required: boolean;
  readonly listed: boolean;
  readonly textual: boolean;
  readonly values: (input: unknown) => readonly string[];
  readonly respelled: (input: unknown, spell: (value: string) => string) => unknown;
};

export type SubjectField = InputField & { readonly role: SubjectKind };

type Read = (input: unknown) => readonly unknown[];

type Write = (input: unknown, change: (value: unknown) => unknown) => unknown;

const textOnly =
  (write: Write) =>
  (input: unknown, spell: (value: string) => string): unknown =>
    write(input, (value) => (typeof value === 'string' ? spell(value) : value));

const roleAt = SchemaAST.resolveAt<FieldRole>(PLACE_ROLE);

const roleOf = (ast: SchemaAST.AST): FieldRole | undefined => {
  const own = roleAt(ast);
  if (own !== undefined) return own;
  if (ast._tag !== 'Union') return undefined;
  for (const member of ast.types) {
    const found = roleOf(member);
    if (found !== undefined) return found;
  }
  return undefined;
};

const textual = (ast: SchemaAST.AST): boolean =>
  ast._tag === 'String' ||
  ast._tag === 'TemplateLiteral' ||
  (ast._tag === 'Union' && ast.types.some(textual)) ||
  (ast._tag === 'Arrays' && [...ast.elements, ...ast.rest].some(textual));

const strings = (read: Read) => (input: unknown) => read(input).filter((value): value is string => typeof value === 'string');

const walk = (
  ast: SchemaAST.AST,
  path: string,
  read: Read,
  write: Write,
  required: boolean,
  listed: boolean,
  seen: Set<SchemaAST.AST>,
  out: InputField[],
) => {
  switch (ast._tag) {
    case 'Objects':
      for (const property of ast.propertySignatures) {
        const name = String(property.name);
        const at = path === '' ? name : `${path}.${name}`;
        const own: Read = (input) =>
          read(input).flatMap((value) =>
            typeof value === 'object' && value !== null && name in value ? [(value as Record<string, unknown>)[name]] : [],
          );
        const ownWrite: Write = (input, change) =>
          write(input, (value) =>
            typeof value === 'object' && value !== null && name in value
              ? { ...value, [name]: change((value as Record<string, unknown>)[name]) }
              : value,
          );
        const isRequired = required && !SchemaAST.isOptional(property.type);
        const role = roleOf(property.type);
        out.push({
          path: at,
          name,
          role,
          required: isRequired,
          listed,
          textual: textual(property.type),
          values: strings(own),
          respelled: textOnly(ownWrite),
        });
        if (role === undefined) walk(property.type, at, own, ownWrite, isRequired, listed, seen, out);
      }
      return;
    case 'Arrays': {
      const items: Read = (input) => read(input).flatMap((value) => (Array.isArray(value) ? value : []));
      const itemsWrite: Write = (input, change) => write(input, (value) => (Array.isArray(value) ? value.map(change) : value));
      for (const element of [...ast.elements, ...ast.rest]) {
        const role = roleOf(element);
        if (role !== undefined && path !== '') {
          const field = out.find((one) => one.path === path);
          if (field !== undefined && field.role === undefined)
            out[out.indexOf(field)] = { ...field, role, listed: true, values: strings(items), respelled: textOnly(itemsWrite) };
          continue;
        }
        walk(element, `${path}[]`, items, itemsWrite, false, true, seen, out);
      }
      return;
    }
    case 'Union':
      for (const member of ast.types) walk(member, path, read, write, required, listed, seen, out);
      return;
    case 'Suspend':
      if (seen.has(ast)) return;
      seen.add(ast);
      walk(ast.thunk(), path, read, write, required, listed, seen, out);
      return;
    default:
      return;
  }
};

const fields = new WeakMap<object, readonly InputField[]>();

export const inputFields = (schema: Schema.Top): readonly InputField[] => {
  const known = fields.get(schema);
  if (known !== undefined) return known;
  const out: InputField[] = [];
  walk(
    schema.ast,
    '',
    (input) => [input],
    (input, change) => change(input),
    true,
    false,
    new Set(),
    out,
  );
  fields.set(schema, out);
  return out;
};

export const subjectFields = (schema: Schema.Top): readonly SubjectField[] =>
  inputFields(schema).filter((field): field is SubjectField => isSubject(field.role));
