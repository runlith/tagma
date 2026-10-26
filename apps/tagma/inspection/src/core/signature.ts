import { Result, Schema, SchemaAST } from 'effect';

type Ast = SchemaAST.AST;

export const membersOf = (ast: Ast | undefined): readonly Ast[] =>
  ast === undefined ? [] : ast._tag === 'Union' ? ast.types.flatMap(membersOf) : ast._tag === 'Suspend' ? membersOf(ast.thunk()) : [ast];

export const describedBy = (ast: Ast): string | undefined =>
  SchemaAST.resolveDescription(ast) ??
  membersOf(ast)
    .map(SchemaAST.resolveDescription)
    .find((one) => one !== undefined);

export const objectsOf = (ast: Ast | undefined, names: readonly string[]): SchemaAST.Objects | undefined => {
  const objects = membersOf(ast).filter((one): one is SchemaAST.Objects => one._tag === 'Objects');
  const overlap = (one: SchemaAST.Objects) => one.propertySignatures.filter((field) => names.includes(String(field.name))).length;
  return objects.reduce<SchemaAST.Objects | undefined>(
    (best, one) => (best === undefined || overlap(one) > overlap(best) ? one : best),
    undefined,
  );
};

export const elementOf = (ast: Ast | undefined, index: number | null): Ast | undefined => {
  const arrays = membersOf(ast).find((one): one is SchemaAST.Arrays => one._tag === 'Arrays');
  if (arrays === undefined) return undefined;
  return (index === null ? undefined : arrays.elements[index]) ?? arrays.rest[0] ?? arrays.elements[0];
};

const identifier = /^[A-Za-z_$][\w$]*$/u;

const literal = (value: SchemaAST.LiteralValue): string =>
  typeof value === 'string'
    ? `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
    : typeof value === 'bigint'
      ? `${value}n`
      : String(value);

const grouped = (text: string): string => (text.includes(' | ') ? `(${text})` : text);

const defaultOf = (field: SchemaAST.PropertySignature): string | undefined => {
  const one = Schema.make<Schema.Codec<unknown, unknown>>(new SchemaAST.Objects([field], []));
  const decoded = Schema.decodeUnknownResult(one)({});
  if (Result.isFailure(decoded)) return undefined;
  const encoded = Schema.encodeUnknownResult(one)(decoded.success);
  if (Result.isFailure(encoded)) return undefined;
  const value = (encoded.success as Readonly<Record<PropertyKey, unknown>>)[field.name];
  return value === undefined ? undefined : JSON.stringify(value);
};

const printer = () => {
  const said = new Set<string>();
  const once = (text: string | undefined): string | undefined => {
    if (text === undefined || said.has(text)) return undefined;
    said.add(text);
    return text;
  };
  const field = (encoded: SchemaAST.PropertySignature, own: SchemaAST.Objects | undefined, indent: string): string => {
    const name = String(encoded.name);
    const declared = own?.propertySignatures.find((one) => String(one.name) === name);
    const optional = SchemaAST.isOptional(encoded.type);
    const fallback = optional && declared !== undefined && encoded.type._tag !== 'Objects' ? defaultOf(declared) : undefined;
    const doc = [
      declared === undefined ? undefined : once(describedBy(declared.type)),
      fallback === undefined ? undefined : `Default: \`${fallback}\`.`,
    ]
      .filter((one) => one !== undefined)
      .join(' ');
    const key = identifier.test(name) ? name : JSON.stringify(name);
    return `${doc === '' ? '' : `${indent}/** ${doc.replaceAll('*/', '*\\/')} */\n`}${indent}readonly ${key}${optional ? '?' : ''}: ${print(encoded.type, declared?.type, indent)};`;
  };
  const print = (encoded: Ast, typed: Ast | undefined, indent: string): string => {
    switch (encoded._tag) {
      case 'Union':
        return [
          ...new Set(
            encoded.types.filter((one) => one._tag !== 'Undefined' && one._tag !== 'Void').map((one) => print(one, typed, indent)),
          ),
        ].join(' | ');
      case 'Suspend':
        return print(encoded.thunk(), typed, indent);
      case 'Literal':
        return literal(encoded.literal);
      case 'Enum':
        return encoded.enums.map(([, value]) => literal(value)).join(' | ');
      case 'TemplateLiteral':
        return 'string';
      case 'Declaration':
        return 'unknown';
      case 'ObjectKeyword':
        return 'object';
      case 'UniqueSymbol':
        return 'symbol';
      case 'Arrays': {
        if (encoded.elements.length === 0 && encoded.rest.length === 1)
          return `readonly ${grouped(print(encoded.rest[0]!, elementOf(typed, null), indent))}[]`;
        const items = [
          ...encoded.elements.map((one, at) => `${print(one, elementOf(typed, at), indent)}${SchemaAST.isOptional(one) ? '?' : ''}`),
          ...encoded.rest.map((one, at) =>
            at === 0 ? `...${grouped(print(one, elementOf(typed, null), indent))}[]` : print(one, undefined, indent),
          ),
        ];
        return `readonly [${items.join(', ')}]`;
      }
      case 'Objects': {
        const own = objectsOf(
          typed,
          encoded.propertySignatures.map((one) => String(one.name)),
        );
        const inner = `${indent}  `;
        const lines = [
          ...encoded.propertySignatures.map((one) => field(one, own, inner)),
          ...encoded.indexSignatures.map(
            (index) => `${inner}readonly [key: ${print(index.parameter, undefined, inner)}]: ${print(index.type, undefined, inner)};`,
          ),
        ];
        return lines.length === 0 ? '{}' : `{\n${lines.join('\n')}\n${indent}}`;
      }
      default:
        return encoded._tag.toLowerCase();
    }
  };
  return print;
};

export const signatureOf = (schema: Schema.Top): string => printer()(SchemaAST.toEncoded(schema.ast), schema.ast, '');
