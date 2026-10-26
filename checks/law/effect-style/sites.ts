import { UnsupportedSource } from '@runlith/code-facts/imports';
import { scriptsOf } from '@runlith/code-facts/adapters';
import { failureOf, parsedNow } from '@runlith/code-facts/js/imports';
import { type Form, TOP } from './declaration';

type Node = { readonly type: string; readonly start: number; readonly end: number; readonly [key: string]: unknown };
type Module = 'Effect' | 'Schema' | 'Scope' | 'Context' | 'Layer' | 'ManagedRuntime';
type Binding = {
  readonly module?: Module | '*';
  readonly typeOnly?: boolean;
  readonly alias?: Node;
  readonly scope?: Scope;
  readonly init?: Node;
  readonly source?: string;
  readonly imported?: string;
};
type Scope = {
  readonly parent?: Scope;
  readonly bindings: Map<string, Binding>;
  readonly types: Map<string, Binding>;
  readonly function: boolean;
};

export type Site = { readonly line: number; readonly symbol: string; readonly form: Form; readonly site: string };

const MODULES: ReadonlySet<string> = new Set(['Effect', 'Schema', 'Scope', 'Context', 'Layer', 'ManagedRuntime']);
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);
const SCOPES = new Set([
  'Program',
  'BlockStatement',
  'FunctionBody',
  'CatchClause',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'SwitchStatement',
  'ClassDeclaration',
  'ClassExpression',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'TSModuleDeclaration',
  'TSModuleBlock',
  'StaticBlock',
]);
const WRAPPERS = new Set([
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
]);
const NAMING = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ClassDeclaration',
  'ClassExpression',
  'VariableDeclarator',
  'MethodDefinition',
  'PropertyDefinition',
  'Property',
  'TSAbstractMethodDefinition',
]);

const isNode = (value: unknown): value is Node =>
  value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
const childOf = (node: Node, key: string): Node | undefined => (isNode(node[key]) ? node[key] : undefined);
const childrenOf = (node: Node, key: string): readonly Node[] => (Array.isArray(node[key]) ? node[key].filter(isNode) : []);
const eachChild = (node: Node, visit: (node: Node) => void): void => {
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const one of value) if (isNode(one)) visit(one);
    } else if (isNode(value)) visit(value);
  }
};
const unwrapped = (raw: Node | undefined): Node | undefined => {
  let node = raw;
  while (node !== undefined && WRAPPERS.has(node.type)) node = childOf(node, 'expression');
  return node;
};
const nameOf = (node: Node | undefined): string | undefined => {
  if (node?.type === 'Identifier' && typeof node.name === 'string') return node.name;
  if (
    (node?.type === 'Literal' || node?.type === 'StringLiteral') &&
    typeof node.value === 'string' &&
    /^[A-Za-z_$][\w$]*$/.test(node.value)
  )
    return node.value;
  return undefined;
};
const memberOf = (raw: Node | undefined): { readonly object: Node; readonly name: string } | undefined => {
  const node = unwrapped(raw);
  if (node === undefined || !['MemberExpression', 'TSQualifiedName'].includes(node.type)) return undefined;
  const object = childOf(node, node.type === 'TSQualifiedName' ? 'left' : 'object');
  const property = childOf(node, node.type === 'TSQualifiedName' ? 'right' : 'property');
  const name = node.computed === true && property?.type === 'Identifier' ? undefined : nameOf(property);
  return object === undefined || name === undefined ? undefined : { object, name };
};
const boundNames = (node: Node | undefined, put: (name: string) => void): void => {
  if (node === undefined) return;
  if (node.type === 'Identifier') {
    put(node.name as string);
    return;
  }
  if (node.type === 'AssignmentPattern') {
    boundNames(childOf(node, 'left'), put);
    return;
  }
  if (node.type === 'RestElement') {
    boundNames(childOf(node, 'argument'), put);
    return;
  }
  if (node.type === 'TSParameterProperty') {
    boundNames(childOf(node, 'parameter'), put);
    return;
  }
  if (node.type === 'ObjectPattern') {
    for (const property of childrenOf(node, 'properties'))
      boundNames(childOf(property, property.type === 'RestElement' ? 'argument' : 'value'), put);
  } else if (node.type === 'ArrayPattern') {
    for (const element of childrenOf(node, 'elements')) boundNames(element, put);
  }
};
const bindingOf = (scope: Scope, name: string, type = false): Binding | undefined => {
  for (let at: Scope | undefined = scope; at !== undefined; at = at.parent) {
    const binding = (type ? at.types : at.bindings).get(name);
    if (binding !== undefined) return binding;
  }
  return undefined;
};
const scopesOf = (program: Node, root: Scope): ReadonlyMap<Node, Scope> => {
  const scopes = new Map<Node, Scope>();
  const visit = (node: Node, outer: Scope, parent: Node | undefined): void => {
    const named = nameOf(childOf(node, 'id'));
    const scope: Scope =
      node === program
        ? root
        : FUNCTIONS.has(node.type) || SCOPES.has(node.type)
          ? {
              parent: outer,
              bindings: new Map(),
              types: new Map(),
              function: FUNCTIONS.has(node.type) || node.type === 'StaticBlock' || node.type === 'TSModuleBlock',
            }
          : outer;
    scopes.set(node, scope);
    if (named !== undefined) {
      if (['FunctionDeclaration', 'ClassDeclaration', 'TSEnumDeclaration', 'TSModuleDeclaration'].includes(node.type))
        outer.bindings.set(named, node.type === 'FunctionDeclaration' ? { init: node } : {});
      if (['ClassDeclaration', 'TSEnumDeclaration', 'TSModuleDeclaration', 'TSInterfaceDeclaration'].includes(node.type))
        outer.types.set(named, {});
      if (node.type === 'TSTypeAliasDeclaration') outer.types.set(named, { alias: childOf(node, 'typeAnnotation'), scope });
    }
    if (FUNCTIONS.has(node.type)) {
      if (named !== undefined) scope.bindings.set(named, {});
      for (const parameter of childrenOf(node, 'params')) boundNames(parameter, (name) => scope.bindings.set(name, {}));
    }
    if ((node.type === 'ClassExpression' || node.type === 'ClassDeclaration') && named !== undefined) {
      scope.bindings.set(named, {});
      scope.types.set(named, {});
    }
    if (node.type === 'CatchClause') boundNames(childOf(node, 'param'), (name) => scope.bindings.set(name, {}));
    for (const parameter of childrenOf(childOf(node, 'typeParameters') ?? node, 'params')) {
      if (parameter.type === 'TSTypeParameter') {
        const name = nameOf(childOf(parameter, 'name'));
        if (name !== undefined) scope.types.set(name, {});
      }
    }
    if (node.type === 'VariableDeclarator') {
      let target = scope;
      if (parent?.kind === 'var') while (!target.function && target.parent !== undefined) target = target.parent;
      const id = childOf(node, 'id');
      const init = parent?.kind === 'const' && id?.type === 'Identifier' ? childOf(node, 'init') : undefined;
      boundNames(id, (name) => target.bindings.set(name, init === undefined ? {} : { init }));
    }
    if (node.type === 'ImportDeclaration') {
      const source = childOf(node, 'source')?.value;
      for (const specifier of childrenOf(node, 'specifiers')) {
        const local = nameOf(childOf(specifier, 'local'));
        if (local === undefined) continue;
        const imported = nameOf(childOf(specifier, 'imported'));
        const module: Module | '*' | undefined =
          source === 'effect'
            ? specifier.type === 'ImportNamespaceSpecifier'
              ? '*'
              : imported !== undefined && MODULES.has(imported)
                ? (imported as Module)
                : undefined
            : typeof source === 'string' &&
                source.startsWith('effect/') &&
                specifier.type === 'ImportNamespaceSpecifier' &&
                MODULES.has(source.slice(7))
              ? (source.slice(7) as Module)
              : undefined;
        const binding = {
          module,
          typeOnly: node.importKind === 'type' || specifier.importKind === 'type',
          source: typeof source === 'string' ? source : undefined,
          imported:
            specifier.type === 'ImportNamespaceSpecifier' ? '*' : specifier.type === 'ImportDefaultSpecifier' ? 'default' : imported,
        };
        scope.types.set(local, binding);
        if (!binding.typeOnly) scope.bindings.set(local, binding);
      }
      return;
    }
    eachChild(node, (child) => visit(child, scope, node));
  };
  visit(program, root, undefined);
  return scopes;
};
const isModule = (raw: Node | undefined, module: Module, scope: Scope, type = false): boolean => {
  const node = unwrapped(raw);
  if (node?.type === 'Identifier') {
    const binding = bindingOf(scope, node.name as string, type);
    return binding?.module === module && (type || binding.typeOnly !== true);
  }
  const member = memberOf(node);
  if (member?.name !== module || member.object.type !== 'Identifier') return false;
  const binding = bindingOf(scope, member.object.name as string, type);
  return binding?.module === '*' && (type || binding.typeOnly !== true);
};
const methodOf = (raw: Node | undefined, module: Module, scope: Scope): string | undefined => {
  const member = memberOf(raw);
  return member !== undefined && isModule(member.object, module, scope) ? member.name : undefined;
};
const callMethod = (raw: Node | undefined, module: Module, scope: Scope): string | undefined => {
  const node = unwrapped(raw);
  return node?.type === 'CallExpression' ? methodOf(childOf(node, 'callee'), module, scope) : undefined;
};
const effectCall = (node: Node, scope: Scope): string | undefined => {
  const callee = unwrapped(childOf(node, 'callee'));
  const direct = methodOf(callee, 'Effect', scope);
  return direct === 'gen' ||
    direct === 'fnUntraced' ||
    (direct === 'fn' && childrenOf(node, 'arguments').some((arg) => unwrapped(arg)?.generator === true))
    ? direct
    : callMethod(callee, 'Effect', scope) === 'fn'
      ? 'fn'
      : undefined;
};
const globalName = (raw: Node | undefined, scope: Scope): string | undefined => {
  const node = unwrapped(raw);
  if (node?.type === 'Identifier') return bindingOf(scope, node.name as string) === undefined ? (node.name as string) : undefined;
  const member = memberOf(node);
  return member?.object.type === 'Identifier' && member.object.name === 'globalThis' && bindingOf(scope, 'globalThis') === undefined
    ? member.name
    : undefined;
};
const clockCall = (node: Node, scope: Scope): boolean => {
  if (node.type === 'NewExpression')
    return globalName(childOf(node, 'callee'), scope) === 'Date' && childrenOf(node, 'arguments').length === 0;
  if (node.type !== 'CallExpression') return false;
  const callee = childOf(node, 'callee');
  if (globalName(callee, scope) === 'setTimeout') return true;
  const member = memberOf(callee);
  if (member === undefined) return false;
  const owner = globalName(member.object, scope);
  return (
    (owner === 'Date' && member.name === 'now') ||
    (owner === 'Promise' && member.name === 'race') ||
    (owner === 'Bun' && member.name === 'sleep')
  );
};
const syncCallbacks = (args: readonly Node[]): readonly Node[] =>
  args.flatMap((raw) => {
    const arg = unwrapped(raw);
    if (arg === undefined) return [];
    if (FUNCTIONS.has(arg.type)) return [arg];
    if (arg.type !== 'ObjectExpression') return [];
    return childrenOf(arg, 'properties').flatMap((one) => {
      const value = unwrapped(childOf(one, 'value'));
      return one.type === 'Property' && nameOf(childOf(one, 'key')) === 'try' && value !== undefined && FUNCTIONS.has(value.type)
        ? [value]
        : [];
    });
  });
const serviceType = (raw: Node | undefined, scope: Scope, seen: Set<Binding>): boolean => {
  const node = unwrapped(raw);
  if (node === undefined) return false;
  if (node.type === 'TSIndexedAccessType') {
    const index = childOf(node, 'indexType');
    return index?.type === 'TSLiteralType' && nameOf(childOf(index, 'literal')) === 'Service';
  }
  if (node.type === 'TSIntersectionType') return childrenOf(node, 'types').some((one) => serviceType(one, scope, seen));
  if (node.type === 'TSParenthesizedType') return serviceType(childOf(node, 'typeAnnotation'), scope, seen);
  if (node.type === 'TSTypeReference' || node.type === 'TSClassImplements')
    return serviceType(childOf(node, node.type === 'TSTypeReference' ? 'typeName' : 'expression'), scope, seen);
  const shape = memberOf(node);
  const service = shape === undefined ? undefined : memberOf(shape.object);
  if (shape?.name === 'Shape' && service?.name === 'Service' && isModule(service.object, 'Context', scope, true)) return true;
  if (node.type === 'Identifier') {
    const binding = bindingOf(scope, node.name as string, true);
    if (binding?.alias !== undefined && !seen.has(binding)) {
      seen.add(binding);
      return serviceType(binding.alias, binding.scope ?? scope, seen);
    }
  }
  return false;
};
const returnsOf = (fn: Node): readonly Node[] => {
  const body = childOf(fn, 'body');
  if (body === undefined) return [];
  if (body.type !== 'BlockStatement' && body.type !== 'FunctionBody') return [body];
  const found: Node[] = [];
  const walk = (node: Node): void => {
    if (FUNCTIONS.has(node.type) || node.type === 'ClassDeclaration' || node.type === 'ClassExpression') return;
    if (node.type === 'ReturnStatement') {
      const argument = childOf(node, 'argument');
      if (argument !== undefined) found.push(argument);
    }
    eachChild(node, walk);
  };
  eachChild(body, walk);
  return found;
};
type Provision = { readonly tag: Node | undefined; readonly value: Node; readonly thunk: boolean };
const sameName = (left: Node | undefined, right: Node | undefined): boolean => {
  const one = unwrapped(left);
  const other = unwrapped(right);
  if (one?.type === 'Identifier' && other?.type === 'Identifier') return one.name === other.name;
  const a = memberOf(one);
  const b = memberOf(other);
  return a !== undefined && b !== undefined && a.name === b.name && sameName(a.object, b.object);
};
export type ImportedReference = (source: string, name: string) => boolean;
const referenceOf = (
  raw: Node | undefined,
  scopes: ReadonlyMap<Node, Scope>,
  imported: ImportedReference,
  seen = new Set<Binding>(),
): boolean => {
  const node = unwrapped(raw);
  if (node === undefined) return false;
  const scope = scopes.get(node);
  if (scope === undefined) return false;
  if (callMethod(node, 'Context', scope) === 'Reference') return true;
  const member = memberOf(node);
  const name = nameOf(member?.object ?? node);
  const binding = name === undefined ? undefined : bindingOf(scope, name);
  if (binding === undefined || binding.typeOnly || seen.has(binding)) return false;
  seen.add(binding);
  if (member === undefined && binding.init !== undefined) return referenceOf(binding.init, scopes, imported, seen);
  if (binding.source === undefined || binding.imported === undefined) return false;
  return member === undefined
    ? binding.imported !== '*' && imported(binding.source, binding.imported)
    : binding.imported === '*' && imported(binding.source, member.name);
};
const constructed = (provision: Provision, scopes: ReadonlyMap<Node, Scope>): boolean => {
  const valued = new Set<Node>();
  const ran = new Set<Node>();
  const initOf = (node: Node, scope: Scope): Node | undefined =>
    node.type === 'Identifier' ? bindingOf(scope, node.name as string)?.init : undefined;
  const value = (raw: Node | undefined): boolean => {
    const node = unwrapped(raw);
    if (node === undefined || valued.has(node)) return false;
    valued.add(node);
    const scope = scopes.get(node);
    if (scope === undefined) return false;
    if (node.type === 'NewExpression') {
      const callee = unwrapped(childOf(node, 'callee'));
      const owner = callee?.type === 'Identifier' ? callee : memberOf(callee)?.object;
      return owner?.type === 'Identifier' && bindingOf(scope, owner.name as string) !== undefined;
    }
    if (node.type === 'Identifier') return value(initOf(node, scope));
    if (node.type === 'ConditionalExpression') return value(childOf(node, 'consequent')) || value(childOf(node, 'alternate'));
    if (node.type === 'LogicalExpression') return value(childOf(node, 'left')) || value(childOf(node, 'right'));
    if (node.type !== 'CallExpression') return false;
    const callee = childOf(node, 'callee');
    const args = childrenOf(node, 'arguments');
    const effect = methodOf(callee, 'Effect', scope);
    if (effect === 'gen' || effect === 'sync') return args.some(run);
    if (effect === 'succeed') return value(args[0]);
    const member = memberOf(callee);
    if (member?.name === 'of' && args.length === 1 && sameName(member.object, provision.tag)) return value(args[0]);
    return run(callee);
  };
  const run = (raw: Node | undefined): boolean => {
    const node = unwrapped(raw);
    if (node === undefined || ran.has(node)) return false;
    ran.add(node);
    const scope = scopes.get(node);
    if (scope === undefined) return false;
    if (FUNCTIONS.has(node.type)) return returnsOf(node).some(value);
    if (node.type === 'Identifier') return run(initOf(node, scope));
    const kind = node.type === 'CallExpression' ? effectCall(node, scope) : undefined;
    return (kind === 'fn' || kind === 'fnUntraced') && childrenOf(node, 'arguments').some(run);
  };
  return provision.thunk ? run(provision.value) : value(provision.value);
};
const LAYERS: ReadonlySet<string> = new Set(['succeed', 'sync', 'effect']);
const provisionOf = (tag: Node | undefined, value: Node | undefined, thunk: boolean): Provision | undefined =>
  value === undefined ? undefined : { tag, value, thunk };
const providedOf = (node: Node, scope: Scope): Provision | undefined => {
  const callee = childOf(node, 'callee');
  const args = childrenOf(node, 'arguments');
  const context = methodOf(callee, 'Context', scope);
  if (context === 'add') return args.length >= 3 ? provisionOf(args[1], args[2], false) : provisionOf(args[0], args[1], false);
  if (context === 'make') return provisionOf(args[0], args[1], false);
  const layer = methodOf(callee, 'Layer', scope);
  if (layer !== undefined && LAYERS.has(layer)) return args.length >= 2 ? provisionOf(args[0], args[1], layer === 'sync') : undefined;
  const inner = unwrapped(callee);
  if (inner?.type !== 'CallExpression') return undefined;
  const curried = methodOf(childOf(inner, 'callee'), 'Layer', scope);
  const tag = childrenOf(inner, 'arguments');
  return curried !== undefined && LAYERS.has(curried) && tag.length === 1 ? provisionOf(tag[0], args[0], curried === 'sync') : undefined;
};
const namedOf = (node: Node): string | undefined => {
  if (!NAMING.has(node.type)) return undefined;
  return node.computed === true
    ? undefined
    : nameOf(
        childOf(
          node,
          ['VariableDeclarator', 'FunctionDeclaration', 'FunctionExpression', 'ClassDeclaration', 'ClassExpression'].includes(node.type)
            ? 'id'
            : 'key',
        ),
      );
};
const topNames = (statement: Node): readonly { readonly node: Node; readonly name: string; readonly parent?: Node }[] => {
  const inner = statement.type.startsWith('Export') ? childOf(statement, 'declaration') : statement;
  if (inner === undefined) return [{ node: statement, name: TOP }];
  if (inner.type === 'VariableDeclaration')
    return childrenOf(inner, 'declarations').map((node) => ({ node, name: nameOf(childOf(node, 'id')) ?? TOP, parent: inner }));
  return [{ node: inner, name: nameOf(childOf(inner, 'id')) ?? (statement.type === 'ExportDefaultDeclaration' ? 'default' : TOP) }];
};
const shapeOf = (text: string, at: number, site: Node, end: number): string => {
  const bodies: Node[] = [];
  const collect = (node: Node): void => {
    const body = node !== site && FUNCTIONS.has(node.type) ? childOf(node, 'body') : undefined;
    if (body !== undefined) bodies.push(body);
    eachChild(node, (child) => {
      if (child !== body) collect(child);
    });
  };
  collect(site);
  let shape = '';
  let from = site.start;
  for (const body of bodies.sort((left, right) => left.start - right.start)) {
    if (body.start < from || body.end > end) continue;
    shape += `${text.slice(at + from, at + body.start)}{}`;
    from = body.end;
  }
  return (shape + text.slice(at + from, at + end)).replace(/\s+/g, ' ').trim();
};
const startsOf = (text: string): readonly number[] => {
  const starts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
};
const lineAt = (starts: readonly number[], offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
};

export const sourceIn = (path: string, text: string) => {
  const module: Scope = { bindings: new Map(), types: new Map(), function: true };
  const scripts = scriptsOf(text, path).map((script) => {
    const parsed = parsedNow(path, script);
    const failure = failureOf(parsed);
    if (failure !== undefined) throw new UnsupportedSource(path, failure.message);
    const program = parsed.program as unknown as Node;
    const root: Scope = script.module ? module : { parent: module, bindings: new Map(), types: new Map(), function: true };
    return { script, program, scopes: scopesOf(program, root) };
  });
  const everyScope = scripts.length === 1 ? scripts[0]!.scopes : new Map(scripts.flatMap(({ scopes }) => [...scopes]));
  return { scripts, everyScope };
};
export type Source = ReturnType<typeof sourceIn>;
export const referenceIn = (source: Source, name: string, imported: ImportedReference): boolean => {
  for (const { program } of source.scripts) {
    for (const statement of childrenOf(program, 'body')) {
      if (statement.type === 'ExportDefaultDeclaration' && name === 'default') {
        const declaration = childOf(statement, 'declaration');
        return referenceOf(childOf(declaration ?? statement, 'id') ?? declaration, source.everyScope, imported);
      }
      if (statement.type !== 'ExportNamedDeclaration' || statement.exportKind === 'type') continue;
      for (const named of topNames(statement))
        if (named.name === name) return referenceOf(childOf(named.node, 'id'), source.everyScope, imported);
      for (const specifier of childrenOf(statement, 'specifiers'))
        if (nameOf(childOf(specifier, 'exported')) === name) return referenceOf(childOf(specifier, 'local'), source.everyScope, imported);
    }
  }
  return false;
};
export const sitesIn = (path: string, text: string, source: Source, imported: ImportedReference): readonly Site[] => {
  const starts = startsOf(text);
  const sites: (Site & { readonly offset: number })[] = [];
  const test = /\.(?:test|itest|stest)\.ts$/.test(path);
  const { scripts, everyScope } = source;
  for (const { script, program, scopes } of scripts) {
    const generators = new Set<Node>();
    const inline = new Set<Node>();
    const callbacks = new Set<Node>();
    const visit = (
      node: Node,
      top: string,
      inner: string | undefined,
      inEffect: boolean,
      inClock: boolean,
      parent: Node | undefined,
    ): void => {
      if (node.type === 'ImportDeclaration') return;
      const name = namedOf(node);
      const within = name !== undefined && name !== top ? name : inner;
      const symbol = top === TOP ? (within ?? TOP) : within === undefined ? top : `${top}.${within}`;
      const scope = scopes.get(node)!;
      const effect = FUNCTIONS.has(node.type) ? generators.has(node) : node.type === 'ClassBody' ? false : inEffect;
      const clock = FUNCTIONS.has(node.type) ? effect || callbacks.has(node) : node.type === 'ClassBody' ? false : inClock;
      const add = (form: Form, site: Node, end = site.end): void => {
        const offset = script.at + site.start;
        const shape = shapeOf(text, script.at, site, end);
        sites.push({ offset, line: lineAt(starts, offset), symbol, form, site: Bun.hash(shape).toString(16).padStart(8, '0').slice(-8) });
      };
      if (
        node.type === 'VariableDeclarator' &&
        parent?.kind === 'const' &&
        nameOf(childOf(node, 'id')) === 'self' &&
        unwrapped(childOf(node, 'init'))?.type === 'ThisExpression'
      )
        add('self-alias', node);
      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        const implemented = childrenOf(node, 'implements').find((one) => serviceType(one, scope, new Set()));
        if (implemented !== undefined) add('service-class', implemented);
        let base = unwrapped(childOf(node, 'superClass'));
        while (base?.type === 'CallExpression') base = unwrapped(childOf(base, 'callee'));
        if (methodOf(base, 'Schema', scope)?.startsWith('TaggedError') === true) {
          const superClass = childOf(node, 'superClass')!;
          const outer = unwrapped(superClass);
          const tag = outer?.type === 'CallExpression' ? childrenOf(outer, 'arguments')[0] : undefined;
          add('schema-tagged-error', superClass, tag?.end);
        }
        const inherited = unwrapped(childOf(node, 'superClass'));
        const global = memberOf(inherited);
        const native =
          inherited?.type === 'Identifier' && bindingOf(scope, inherited.name as string) === undefined
            ? nameOf(inherited)
            : global?.object.type === 'Identifier' && global.object.name === 'globalThis' && bindingOf(scope, 'globalThis') === undefined
              ? global.name
              : undefined;
        const tagged = childrenOf(childOf(node, 'body') ?? node, 'body').some((member) => {
          if (member.type === 'MethodDefinition' && member.kind === 'constructor')
            return childrenOf(childOf(member, 'value') ?? member, 'params').some((parameter) => {
              if (parameter.type !== 'TSParameterProperty') return false;
              let tag = false;
              boundNames(parameter, (name) => {
                if (name === '_tag') tag = true;
              });
              return tag;
            });
          return (
            member.type === 'PropertyDefinition' &&
            member.static !== true &&
            nameOf(childOf(member, 'key')) === '_tag' &&
            (member.computed !== true || childOf(member, 'key')?.type === 'Literal')
          );
        });
        if ((native === 'Error' || native === 'TypeError') && tagged) add('native-tagged-error', inherited!);
      }
      if (FUNCTIONS.has(node.type) && node.generator !== true && !inline.has(node)) {
        const body = childOf(node, 'body');
        const statements = body === undefined ? [] : childrenOf(body, 'body');
        const returned =
          body?.type === 'BlockStatement' || body?.type === 'FunctionBody'
            ? statements.length === 1 && statements[0]?.type === 'ReturnStatement'
              ? childOf(statements[0], 'argument')
              : undefined
            : body;
        let head = unwrapped(returned);
        while (head?.type === 'CallExpression') {
          const pipe = memberOf(childOf(head, 'callee'));
          if (pipe?.name !== 'pipe') break;
          head = unwrapped(pipe.object);
        }
        if (callMethod(head, 'Effect', scopes.get(head!) ?? scope) === 'gen') add('gen-wrapper', node);
      }
      if (effect && node.type === 'ThrowStatement') add('throw-in-effect', node);
      if (clock && clockCall(node, scope)) add('clock-bypass', node);
      if (node.type === 'CallExpression') {
        const callee = childOf(node, 'callee');
        const args = childrenOf(node, 'arguments');
        if (clock && ['sync', 'try', 'tryPromise'].includes(methodOf(callee, 'Effect', scope) ?? ''))
          for (const callback of syncCallbacks(args)) callbacks.add(callback);
        for (const raw of args) {
          const arg = unwrapped(raw);
          if (arg !== undefined && FUNCTIONS.has(arg.type)) inline.add(arg);
        }
        const kind = effectCall(node, scope);
        if (kind !== undefined) {
          for (const raw of args) {
            const arg = unwrapped(raw);
            if (arg?.generator === true && FUNCTIONS.has(arg.type)) generators.add(arg);
            if (
              kind !== 'fnUntraced' &&
              arg?.type === 'ObjectExpression' &&
              childrenOf(arg, 'properties').some(
                (one) =>
                  one.type === 'Property' &&
                  nameOf(childOf(one, 'key')) === 'self' &&
                  (one.computed !== true || childOf(one, 'key')?.type === 'Literal'),
              )
            )
              add('self-binding', arg);
          }
        }
        const provided = providedOf(node, scope);
        if (provided !== undefined && constructed(provided, everyScope) && !referenceOf(provided.tag, everyScope, imported))
          add('service-instance', provided.value);
        const pipe = memberOf(callee);
        const head = pipe?.name === 'pipe' ? unwrapped(pipe.object) : undefined;
        if (head?.type === 'CallExpression' && ['fn', 'fnUntraced'].includes(effectCall(head, scope) ?? '')) add('pipe-after-fn', node);
        const decode = methodOf(callee, 'Schema', scope);
        if (effect && decode !== undefined && /^decode\w*Sync$/.test(decode)) add('sync-decode-in-effect', node);
        const run = methodOf(callee, 'Effect', scope);
        if (run === 'runSync' && callMethod(args[0], 'Scope', scope) === 'make') add('scope-run-sync', node);
        if (test && ((run !== undefined && /^(?:runPromise|runSync)/.test(run)) || methodOf(callee, 'ManagedRuntime', scope) === 'make'))
          add('test-runner', callee!);
      }
      if (
        test &&
        node.type === 'MemberExpression' &&
        !(parent?.type === 'CallExpression' && unwrapped(childOf(parent, 'callee')) === node)
      ) {
        const runner = methodOf(node, 'Effect', scope);
        if ((runner !== undefined && /^(?:runPromise|runSync)/.test(runner)) || methodOf(node, 'ManagedRuntime', scope) === 'make')
          add('test-runner', node);
      }
      eachChild(node, (child) => visit(child, top, within, effect, clock, node));
    };
    for (const statement of childrenOf(program, 'body')) {
      for (const { node, name, parent } of topNames(statement)) visit(node, name, undefined, false, false, parent);
    }
  }
  return sites.sort((left, right) => left.offset - right.offset).map(({ line, symbol, form, site }) => ({ line, symbol, form, site }));
};
