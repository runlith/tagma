import { type Schema, SchemaRepresentation } from 'effect';

type Node = SchemaRepresentation.Representation;

export const schemaShape = (schema: Schema.Top): string => written(SchemaRepresentation.toRepresentation(schema.ast));

function written(document: SchemaRepresentation.Document): string {
  const recursive = new Map<string, string>();
  const render = (node: Node, path: ReadonlySet<string>): string => {
    switch (node._tag) {
      case 'Reference': {
        const target = document.references[node.$ref];
        if (target === undefined) return node.$ref;
        if (!path.has(node.$ref)) return render(target, new Set([...path, node.$ref]));
        if (!recursive.has(node.$ref)) {
          recursive.set(node.$ref, '');
          recursive.set(node.$ref, render(target, new Set([node.$ref])));
        }
        return node.$ref;
      }
      case 'Suspend':
        return render(node.thunk, path);
      case 'Union': {
        const members = node.types.filter((member) => member._tag !== 'Undefined' && member._tag !== 'Void');
        return checked([...new Set(members.map((member) => render(member, path)))].join(' | '), node.checks);
      }
      case 'Literal':
        return checked(JSON.stringify(node.literal), node.checks);
      case 'Enum':
        return checked(node.enums.map(([, value]) => JSON.stringify(value)).join(' | '), node.checks);
      case 'Arrays': {
        const rest = node.rest.map((member) => render(member, path));
        if (node.elements.length === 0 && rest.length === 1) return checked(`${grouped(rest[0]!)}[]`, node.checks);
        const items = [
          ...node.elements.map((element) => `${render(element.type, path)}${element.isOptional ? '?' : ''}`),
          ...rest.map((member, at) => (at === 0 ? `...${grouped(member)}[]` : member)),
        ];
        return checked(`[${items.join(', ')}]`, node.checks);
      }
      case 'Objects': {
        const fields = [
          ...node.propertySignatures.map((field) => `${String(field.name)}${field.isOptional ? '?' : ''}: ${render(field.type, path)}`),
          ...node.indexSignatures.map((index) => `[key: ${render(index.parameter, path)}]: ${render(index.type, path)}`),
        ];
        return checked(fields.length === 0 ? '{}' : `{ ${fields.join(', ')} }`, node.checks);
      }
      case 'TemplateLiteral':
        return checked(
          `\`${node.parts.map((part) => (part._tag === 'Literal' ? String(part.literal) : `\${${render(part, path)}}`)).join('')}\``,
          node.checks,
        );
      case 'Declaration':
        return checked(typeof node.annotations?.identifier === 'string' ? node.annotations.identifier : 'unknown', node.checks);
      case 'ObjectKeyword':
        return checked('object', node.checks);
      case 'UniqueSymbol':
        return checked('symbol', node.checks);
      default:
        return checked(node._tag.toLowerCase(), node.checks);
    }
  };
  const root = render(document.representation, new Set());
  const bindings = [...recursive].map(([name, shape]) => `${name} = ${shape}`);
  return bindings.length === 0 ? root : `${root} where ${bindings.join('; ')}`;
}

const grouped = (text: string): string => (text.includes(' | ') ? `(${text})` : text);

function checked(text: string, checks: readonly SchemaRepresentation.Check[]): string {
  const expected = checks.flatMap(expectations);
  return expected.length === 0 ? text : `${text} (${expected.join('; ')})`;
}

function expectations(check: SchemaRepresentation.Check): readonly string[] {
  const own = check.annotations?.expected;
  if (typeof own === 'string') return [own];
  return check._tag === 'FilterGroup' ? check.checks.flatMap(expectations) : [];
}
