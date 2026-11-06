import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { svelteProgram } from '../src/plugin/svelteProgram.js';

const root = resolve(import.meta.dir, '../../..');
const app = join(root, 'apps/tagma/app');
const ENTRY = join(app, 'src/lib/features/plugin-views/ui.ts');
const COMPOSITION = join(app, 'src/lib/app/composition.ts');
const FACADE_DIR = join(root, 'packages/tagma/src/plugin');

export const FACADE = join(FACADE_DIR, 'ui.generated.d.ts');
const SDK_SOURCES = join(root, 'packages/tagma/src');
const realFile = (name: string): string => ts.sys.realpath?.(name) ?? name;
const SDK_REAL = realFile(SDK_SOURCES);
const FACADE_REAL = realFile(FACADE_DIR);
const OTHER_SDK = /\/packages\/tagma\/src\//u;

const PUBLIC_PROPS: Readonly<Record<string, readonly string[]>> = {
  Frame: ['src', 'title', 'height', 'fill', 'media'],
};

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  allowNonTsExtensions: true,
  types: [],
  baseUrl: app,
  paths: { '$lib/*': [join(app, 'src/lib/*')] },
};

const svelteTarget = (specifier: string, containing: string): string => {
  if (specifier.startsWith('$lib/')) return join(app, 'src/lib', specifier.slice('$lib/'.length));
  if (specifier.startsWith('.') || isAbsolute(specifier)) return resolve(dirname(containing), specifier);
  return Bun.resolveSync(specifier, dirname(containing));
};

const uiProgram = (): ts.Program =>
  svelteProgram({
    options,
    rootNames: [ENTRY, COMPOSITION],
    resolve: (specifier, containing, compiler, host) => {
      if (specifier.endsWith('.svelte')) {
        const target = svelteTarget(specifier, containing);
        if (ts.sys.fileExists(target)) return target;
      }
      return ts.resolveModuleName(specifier, containing, compiler, host);
    },
  }).program;

type Origin = { readonly module: string | null } | 'local';

const KEYWORD = /^[A-Za-z_$][\w$]*$/u;

const indented = (text: string): string => text.replaceAll('\n', '\n  ');

const sorted = (members: readonly string[]): string[] => {
  const weight = (member: string): number => (member === 'null' ? 2 : member === 'undefined' ? 3 : 0);
  return [...new Set(members)].sort((left, right) => weight(left) - weight(right) || (left < right ? -1 : left > right ? 1 : 0));
};

const exportTargets = (value: unknown): readonly string[] =>
  typeof value === 'string' ? [value] : typeof value === 'object' && value !== null ? Object.values(value).flatMap(exportTargets) : [];

const packageSpecifier = (file: string): string | null => {
  const marker = file.lastIndexOf('/node_modules/') + '/node_modules/'.length;
  const path = file.slice(marker).split('/');
  const name = path[0]!.startsWith('@') ? `${path[0]}/${path[1]}` : path[0]!;
  const directory = file.slice(0, marker) + name;
  const manifest = JSON.parse(ts.sys.readFile(join(directory, 'package.json'))!) as {
    readonly exports?: Readonly<Record<string, unknown>>;
  };
  for (const [key, value] of Object.entries(manifest.exports ?? {}))
    if (!key.includes('*') && exportTargets(value).some((target) => resolve(directory, target) === file))
      return key === '.' ? name : `${name}${key.slice(1)}`;
  return null;
};

const facadeTypes = (program: ts.Program) => {
  const checker = program.getTypeChecker();
  const imports = new Map<string, Set<string>>();
  const claimed = new Map<string, string>();
  const known = new Map<ts.Symbol, string>();
  const hoisted = new Map<string, { readonly type: ts.Type; readonly symbol: ts.Symbol }>();

  const moduleOf = (declaration: ts.Declaration): string | null => {
    for (let node: ts.Node | undefined = declaration; node !== undefined; node = node.parent)
      if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) return node.name.text;
    return null;
  };

  const originOf = (symbol: ts.Symbol): Origin => {
    const [declaration] = symbol.declarations ?? [];
    if (declaration === undefined) return { module: null };
    const file = declaration.getSourceFile();
    if (program.isSourceFileDefaultLibrary(file)) return { module: null };
    const actual = realFile(file.fileName);
    if (actual.startsWith(`${SDK_REAL}/`)) return { module: `./${relative(FACADE_REAL, actual).replace(/\.ts$/u, '.js')}` };
    if (OTHER_SDK.test(actual))
      throw new Error(
        `the facade reached the SDK's sources at ${file.fileName}, outside this checkout's ${SDK_SOURCES}, so they would be expanded`,
      );
    if (file.fileName.includes('/node_modules/')) {
      const named = moduleOf(declaration);
      if (named !== null) return { module: named };
      if (!ts.isExternalModule(file)) return { module: null };
      const specifier = packageSpecifier(file.fileName);
      if (specifier === null) return 'local';
      const reached = ts.resolveModuleName(specifier, FACADE, options, ts.sys).resolvedModule?.resolvedFileName;
      return reached === file.fileName ? { module: specifier } : 'local';
    }
    return 'local';
  };

  const named = (symbol: ts.Symbol, origin: { readonly module: string | null }): string => {
    if (origin.module === null) return symbol.name;
    const standing = claimed.get(symbol.name);
    if (standing !== undefined && standing !== origin.module)
      throw new Error(`the facade imports ${symbol.name} from both ${standing} and ${origin.module}`);
    claimed.set(symbol.name, origin.module);
    imports.set(origin.module, (imports.get(origin.module) ?? new Set()).add(symbol.name));
    return symbol.name;
  };

  const applied = (name: string, args: readonly ts.Type[] | undefined, seen: readonly ts.Type[]): string =>
    args === undefined || args.length === 0 ? name : `${name}<${args.map((one) => print(one, seen)).join(', ')}>`;

  const referenced = (name: string, reference: ts.TypeReference, seen: readonly ts.Type[]): string => {
    const parameters = (reference.target as ts.InterfaceType).typeParameters ?? [];
    const printed = checker
      .getTypeArguments(reference)
      .slice(0, parameters.length)
      .map((one) => print(one, seen));
    const fallbacks = parameters.map((parameter) => {
      const fallback = checker.getDefaultFromTypeParameter(parameter);
      return fallback === undefined ? undefined : print(fallback, seen);
    });
    let kept = printed.length;
    while (kept > 0 && printed[kept - 1] === fallbacks[kept - 1]) kept -= 1;
    return kept === 0 ? name : `${name}<${printed.slice(0, kept).join(', ')}>`;
  };

  const isFunctionShape = (type: ts.Type): boolean =>
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    type.getCallSignatures().length === 1 &&
    type.getConstructSignatures().length === 0 &&
    checker.getPropertiesOfType(type).length === 0 &&
    checker.getIndexInfosOfType(type).length === 0;

  const isNamed = (type: ts.Type): boolean => {
    const alias = type.aliasSymbol;
    if (alias !== undefined && (known.has(alias) || originOf(alias) !== 'local')) return true;
    if (!(type.flags & ts.TypeFlags.Object)) return false;
    const symbol = (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference ? (type as ts.TypeReference).target.symbol : type.symbol;
    return symbol !== undefined && symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class) ? originOf(symbol) !== 'local' : false;
  };

  const atom = (type: ts.Type, seen: readonly ts.Type[]): string => {
    const text = print(type, seen);
    const wrapped =
      !isNamed(type) &&
      !(type.flags & ts.TypeFlags.Boolean) &&
      ((type.flags & (ts.TypeFlags.Union | ts.TypeFlags.Intersection | ts.TypeFlags.Conditional)) !== 0 || isFunctionShape(type));
    return wrapped ? `(${text})` : text;
  };

  const typeParameters = (parameters: readonly ts.TypeParameter[] | undefined, seen: readonly ts.Type[]): string => {
    if (parameters === undefined || parameters.length === 0) return '';
    const one = (parameter: ts.TypeParameter): string => {
      const constraint = checker.getBaseConstraintOfType(parameter);
      const fallback = checker.getDefaultFromTypeParameter(parameter);
      const bound =
        constraint === undefined || constraint === parameter || constraint.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)
          ? ''
          : ` extends ${print(constraint, seen)}`;
      return `${parameter.symbol.name}${bound}${fallback === undefined ? '' : ` = ${print(fallback, seen)}`}`;
    };
    return `<${parameters.map(one).join(', ')}>`;
  };

  const signature = (call: ts.Signature, arrow: boolean, seen: readonly ts.Type[]): string => {
    const parameters = [...(call.thisParameter === undefined ? [] : [call.thisParameter]), ...call.getParameters()].map((parameter) => {
      const declaration = parameter.valueDeclaration as ts.ParameterDeclaration | undefined;
      const rest = declaration !== undefined && ts.isParameter(declaration) && declaration.dotDotDotToken !== undefined;
      const optional =
        declaration !== undefined &&
        ts.isParameter(declaration) &&
        (declaration.questionToken !== undefined || declaration.initializer !== undefined);
      const type = checker.getTypeOfSymbol(parameter);
      const shown = optional && type.isUnion() ? withoutUndefined(type, seen) : print(type, seen);
      return `${rest ? '...' : ''}${parameter.name}${optional ? '?' : ''}: ${shown}`;
    });
    return `${typeParameters(call.typeParameters, seen)}(${parameters.join(', ')})${arrow ? ' =>' : ':'} ${print(checker.getReturnTypeOfSignature(call), seen)}`;
  };

  const withoutUndefined = (type: ts.UnionType, seen: readonly ts.Type[]): string => {
    const rest = type.types.filter((one) => !(one.flags & ts.TypeFlags.Undefined));
    return rest.length === 0 ? 'undefined' : unionOf(rest, seen);
  };

  const unionOf = (members: readonly ts.Type[], seen: readonly ts.Type[]): string => {
    const printed = members.map((one) => atom(one, seen));
    const merged =
      printed.includes('true') && printed.includes('false')
        ? [...printed.filter((one) => one !== 'true' && one !== 'false'), 'boolean']
        : printed;
    return sorted(merged).join(' | ');
  };

  const key = (name: string): string => (KEYWORD.test(name) ? name : JSON.stringify(name));

  const member = (property: ts.Symbol, seen: readonly ts.Type[]): string => {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    const readonly = declaration !== undefined && (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0;
    const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
    const type = checker.getTypeOfSymbol(property);
    const shown = optional && type.isUnion() ? withoutUndefined(type, seen) : print(type, seen);
    return `${readonly ? 'readonly ' : ''}${key(property.name)}${optional ? '?' : ''}: ${shown}`;
  };

  const onlyBase = (type: ts.Type): ts.Type | undefined => {
    const symbol = type.symbol;
    if (symbol === undefined || !(symbol.flags & ts.SymbolFlags.Interface)) return undefined;
    const declared = checker.getDeclaredTypeOfSymbol(symbol) as ts.InterfaceType;
    const bases = checker.getBaseTypes(declared);
    const own =
      symbol.members === undefined ? 0 : [...symbol.members.values()].filter((one) => !(one.flags & ts.SymbolFlags.TypeParameter)).length;
    return own === 0 && bases.length === 1 ? bases[0] : undefined;
  };

  const structural = (type: ts.Type, seen: readonly ts.Type[]): string => {
    const base = onlyBase(type);
    if (base !== undefined) return print(base, seen);
    if (isFunctionShape(type)) return signature(type.getCallSignatures()[0]!, true, seen);
    const members = [
      ...type.getCallSignatures().map((call) => signature(call, false, seen)),
      ...type.getConstructSignatures().map((call) => `new ${signature(call, false, seen)}`),
      ...checker
        .getIndexInfosOfType(type)
        .map((info) => `${info.isReadonly ? 'readonly ' : ''}[key: ${print(info.keyType, seen)}]: ${print(info.type, seen)}`),
      ...checker.getPropertiesOfType(type).map((property) => member(property, seen)),
    ];
    if (
      members.length === 0 &&
      ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped) !== 0 &&
      type.aliasTypeArguments?.some((one) => (one.flags & ts.TypeFlags.TypeParameter) !== 0) === true
    )
      throw new Error(
        `the facade cannot print the generic mapped type ${type.aliasSymbol?.name ?? ''}: it has no members, so it would publish as {}`,
      );
    return members.length === 0 ? '{}' : `{\n  ${indented(members.join(';\n'))};\n}`;
  };

  const tupleOf = (type: ts.TypeReference, seen: readonly ts.Type[]): string => {
    const target = type.target as ts.TupleType;
    const items = checker.getTypeArguments(type).map((one, at) => {
      const flags = target.elementFlags[at]!;
      const label = target.labeledElementDeclarations?.[at]?.name.getText();
      const body = flags & ts.ElementFlags.Variable ? `...${atom(one, seen)}[]` : print(one, seen);
      return `${label === undefined ? '' : `${label}${flags & ts.ElementFlags.Optional ? '?' : ''}: `}${body}${label === undefined && flags & ts.ElementFlags.Optional ? '?' : ''}`;
    });
    return `${target.readonly ? 'readonly ' : ''}[${items.join(', ')}]`;
  };

  function print(type: ts.Type, seen: readonly ts.Type[], own?: ts.Symbol): string {
    if ((type as { readonly intrinsicName?: string }).intrinsicName === 'error')
      throw new Error('a type of the facade did not resolve, so it would publish as any');
    const alias = type.aliasSymbol;
    if (seen.includes(type)) {
      if (alias === undefined || (type.aliasTypeArguments?.length ?? 0) > 0)
        throw new Error(`the facade cannot print the recursive type ${checker.typeToString(type)}`);
      const standing = hoisted.get(alias.name);
      if (standing !== undefined && standing.type !== type)
        throw new Error(`two recursive types of the facade are both named ${alias.name}`);
      hoisted.set(alias.name, { type, symbol: alias });
      return known.get(alias) ?? alias.name;
    }
    if (alias !== undefined && alias !== own) {
      const standing = known.get(alias);
      if (standing !== undefined) return applied(standing, type.aliasTypeArguments, seen);
      const origin = originOf(alias);
      if (origin !== 'local') return applied(named(alias, origin), type.aliasTypeArguments, seen);
    }
    const inner = [...seen, type];
    const flags = type.flags;
    if (flags & ts.TypeFlags.Union) return unionOf((type as ts.UnionType).types, inner);
    if (flags & ts.TypeFlags.Intersection) return (type as ts.IntersectionType).types.map((one) => atom(one, inner)).join(' & ');
    if (flags & ts.TypeFlags.TypeParameter) return type.symbol.name;
    if (flags & ts.TypeFlags.Index) return `keyof ${atom((type as ts.IndexType).type, inner)}`;
    if (flags & ts.TypeFlags.IndexedAccess) {
      const access = type as ts.IndexedAccessType;
      return `${atom(access.objectType, inner)}[${print(access.indexType, inner)}]`;
    }
    if (flags & ts.TypeFlags.Conditional) {
      const { root, checkType, extendsType } = type as ts.ConditionalType;
      const branch = (node: ts.TypeNode): string => print(checker.getTypeFromTypeNode(node), inner);
      return `${atom(checkType, inner)} extends ${atom(extendsType, inner)} ? ${branch(root.node.trueType)} : ${branch(root.node.falseType)}`;
    }
    if (flags & ts.TypeFlags.Object) {
      const object = type as ts.ObjectType;
      if (object.objectFlags & ts.ObjectFlags.Reference) {
        const reference = type as ts.TypeReference;
        if (checker.isTupleType(type)) return tupleOf(reference, inner);
        const origin = originOf(reference.target.symbol);
        if (origin !== 'local') return referenced(named(reference.target.symbol, origin), reference, inner);
      } else if (type.symbol !== undefined && type.symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class)) {
        const origin = originOf(type.symbol);
        if (origin !== 'local') return named(type.symbol, origin);
      }
      return structural(type, inner);
    }
    if (flags & (ts.TypeFlags.NonPrimitive | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping | ts.TypeFlags.UniqueESSymbol))
      return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
    if (
      flags &
      (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null)
    )
      return checker.typeToString(type);
    if (
      flags &
      (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike)
    )
      return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
    throw new Error(`the facade cannot print ${checker.typeToString(type)} (type flags ${flags})`);
  }

  const declaredAlias = (name: string, symbol: ts.Symbol): string => {
    const declaration = symbol.declarations?.find(ts.isTypeAliasDeclaration);
    if (declaration === undefined) throw new Error(`${name} is not a type alias`);
    const declared = checker.getDeclaredTypeOfSymbol(symbol);
    const parameters = declaration.typeParameters?.map((one) => checker.getTypeAtLocation(one) as ts.TypeParameter);
    return `export type ${name}${typeParameters(parameters, [])} = ${print(declared, [], symbol)};`;
  };

  const componentOf = (name: string, type: ts.Type): string => {
    const only = PUBLIC_PROPS[name];
    if (only === undefined) return print(type, []);
    const reference = type as ts.TypeReference;
    const [props, exposed, bindings] = checker.getTypeArguments(reference);
    if (props === undefined || exposed === undefined || bindings === undefined) throw new Error(`${name} is not a component type`);
    const available = checker.getPropertiesOfType(props);
    const picked = only.map((one) => {
      const property = available.find((candidate) => candidate.name === one);
      if (property === undefined) throw new Error(`${name} has no prop ${one}`);
      return member(property, []);
    });
    const origin = originOf(reference.target.symbol);
    if (origin === 'local') throw new Error(`${name} is not a Svelte component type`);
    return `${named(reference.target.symbol, origin)}<{\n  ${indented(picked.join(';\n'))};\n}, ${print(exposed, [])}, ${print(bindings, [])}>`;
  };

  const isComponent = (symbol: ts.Symbol): boolean =>
    symbol.declarations?.some((declaration) => declaration.getSourceFile().fileName.endsWith('.svelte')) === true;

  const valueExport = (name: string, symbol: ts.Symbol, declare: string): string => {
    const type = checker.getTypeOfSymbol(symbol);
    return `${declare} ${name}: ${isComponent(symbol) ? componentOf(name, type) : print(type, [])};`;
  };

  const namespaceOf = (name: string, symbol: ts.Symbol): string => {
    const members = checker.getExportsOfModule(symbol).map((one) => {
      const target = one.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(one) : one;
      return `  ${indented(valueExport(one.name, target, 'const'))}`;
    });
    return `export declare namespace ${name} {\n${members.join('\n')}\n}`;
  };

  const exportsOf = (): readonly string[] => {
    const entry = program.getSourceFile(ENTRY);
    const entrySymbol = entry === undefined ? undefined : checker.getSymbolAtLocation(entry);
    if (entrySymbol === undefined) throw new Error('the /ui implementation has no exports');
    const exported = checker
      .getExportsOfModule(entrySymbol)
      .map((symbol) => ({ name: symbol.name, symbol: symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol }));
    for (const { name, symbol } of exported)
      if (symbol.flags & ts.SymbolFlags.TypeAlias && !isComponent(symbol) && originOf(symbol) === 'local') known.set(symbol, name);
    const declarations = exported.map(({ name, symbol }) => {
      const origin = originOf(symbol);
      if (origin !== 'local' && origin.module !== null) {
        const value = symbol.flags & ts.SymbolFlags.Value;
        return `export ${value ? '' : 'type '}{ ${name} } from ${JSON.stringify(origin.module)};`;
      }
      if (isComponent(symbol)) return valueExport(name, symbol, 'export declare const');
      if (symbol.flags & ts.SymbolFlags.TypeAlias) return declaredAlias(name, symbol);
      if (symbol.flags & ts.SymbolFlags.ValueModule) return namespaceOf(name, symbol);
      return valueExport(name, symbol, 'export declare const');
    });
    const emitted = new Set<string>();
    for (
      let pending = [...hoisted.keys()].filter((one) => !emitted.has(one));
      pending.length > 0;
      pending = [...hoisted.keys()].filter((one) => !emitted.has(one))
    )
      for (const name of pending) {
        emitted.add(name);
        const { type, symbol } = hoisted.get(name)!;
        declarations.push(`type ${name} = ${print(type, [], symbol)};`);
      }
    return declarations;
  };

  return { exportsOf, imports };
};

export const uiFacade = (): { readonly text: string; readonly files: readonly string[] } => {
  const program = uiProgram();
  const { exportsOf, imports } = facadeTypes(program);
  const body = exportsOf();
  const heads = [...imports]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([module, names]) => `import type { ${[...names].sort().join(', ')} } from ${JSON.stringify(module)};`);
  return {
    text: ['/// <reference lib="dom" />', ...heads, '', body.join('\n\n'), ''].join('\n'),
    files: program.getSourceFiles().map((file) => file.fileName),
  };
};
