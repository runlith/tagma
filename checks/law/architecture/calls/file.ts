import ts from 'typescript';
import { matcher } from '../../declarations/glob';
import { type Act, type Fn, labelOf, METHODS, rowBearing, type Value } from './model';
import type { CallParams } from './params';
import type { World } from './world';

type Space = 'values' | 'types';

type Slot = {
  value: Value | null | undefined;
  thunk: (() => Value | null | undefined) | undefined;
  busy: boolean;
  from: { readonly spec: string; readonly name: string } | undefined;
  imported: boolean;
};

type Frame = { readonly returns: (Value | undefined)[]; readonly declared: Value | undefined };

type Scope = {
  readonly values: Map<string, Slot>;
  readonly types: Map<string, Slot>;
  readonly parent: Scope | undefined;
  readonly frame: Frame;
  thisValue: Value | undefined;
};

type Exported = {
  value?: Slot | undefined;
  type?: Slot | undefined;
  forward?: ((space: Space) => Value | undefined) | undefined;
};

export type Site = { readonly act: Act; readonly label: string; readonly line: number };

const slotOf = (init: Partial<Slot> = {}): Slot => ({
  value: undefined,
  thunk: undefined,
  busy: false,
  from: undefined,
  imported: false,
  ...init,
});

const force = (slot: Slot): Value | undefined => {
  if (slot.value !== undefined) return slot.value ?? undefined;
  const thunk = slot.thunk;
  if (thunk === undefined || slot.busy) return undefined;
  slot.busy = true;
  try {
    slot.value = thunk() ?? null;
    slot.thunk = undefined;
  } finally {
    slot.busy = false;
  }
  return slot.value ?? undefined;
};

const once = <T>(make: () => T): (() => T) => {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      done = true;
      value = make();
    }
    return value;
  };
};

const scopeOf = (parent: Scope | undefined, frame: Frame): Scope => ({
  values: new Map(),
  types: new Map(),
  parent,
  frame,
  thisValue: undefined,
});

const find = (scope: Scope, name: string, space: Space): Slot | undefined => {
  for (let at: Scope | undefined = scope; at !== undefined; at = at.parent) {
    const held = at[space].get(name);
    if (held !== undefined) return held;
  }
  return undefined;
};

const thisOf = (scope: Scope): Value | undefined => {
  for (let at: Scope | undefined = scope; at !== undefined; at = at.parent) if (at.thisValue !== undefined) return at.thisValue;
  return undefined;
};

const has = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []).some((one) => one.kind === kind);

const nameOf = (name: ts.PropertyName | ts.BindingName | undefined): string | undefined => {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  return undefined;
};

const literalOf = (node: ts.Expression): string | undefined =>
  ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;

const unwrap = (value: Value | undefined): Value | undefined => (value?.k === 'service' ? { k: 'cap', cap: value.cap } : value);

const callbackOf = (params: readonly (Value | undefined)[]): Value => ({
  k: 'fn',
  fn: { params, returns: undefined, analyze: () => undefined },
});

const WRAPPED = new Set([
  'Effect',
  'Promise',
  'Awaited',
  'Readonly',
  'NonNullable',
  'Iterable',
  'IterableIterator',
  'AsyncIterable',
  'Option',
]);
const ARRAYS = new Set(['Array', 'ReadonlyArray', 'Set', 'ReadonlySet']);
const PRESERVING = new Set([
  'mapError',
  'orDie',
  'orElse',
  'catchAll',
  'catchTag',
  'catchCause',
  'withSpan',
  'provide',
  'provideService',
  'provideLayer',
  'timeout',
  'retry',
  'ensuring',
  'onInterrupt',
  'tapError',
  'tapErrorTag',
  'annotateLogs',
  'withLogSpan',
  'uninterruptible',
  'interruptible',
]);
const THEN = new Set(['flatMap', 'map', 'andThen']);

export class Registry {
  private readonly models = new Map<string, FileModel | null>();
  private readonly resolved = new Map<string, string | null>();
  private readonly visiting = new Set<string>();
  private readonly isRow: (path: string) => boolean;

  constructor(
    readonly world: World,
    readonly params: CallParams,
  ) {
    this.isRow = matcher(params.rows);
  }

  resolve(specifier: string, from: string): string | null {
    const key = `${from}\0${specifier}`;
    const held = this.resolved.get(key);
    if (held !== undefined) return held;
    const found = this.world.resolve(specifier, from);
    this.resolved.set(key, found);
    return found;
  }

  model(path: string): FileModel | undefined {
    const held = this.models.get(path);
    if (held !== undefined) return held ?? undefined;
    const text = this.world.read(path);
    const made = text === undefined ? null : new FileModel(this, path, text);
    this.models.set(path, made);
    return made ?? undefined;
  }

  sourceValue(path: string, name: string, space: Space): Value | undefined {
    const source = this.params.sources.find((one) => one.path === path && one.name === name);
    if (source === undefined) return undefined;
    if (source.form === 'service') return { k: 'service', cap: source.capability };
    return space === 'types' ? { k: 'cap', cap: source.capability } : undefined;
  }

  imported(path: string | null, name: string, space: Space): Value | undefined {
    if (path === null) return undefined;
    const sourced = this.sourceValue(path, name, space);
    if (sourced !== undefined) return sourced;
    if (this.isRow(path)) return { k: 'cap', cap: 'row' };
    const key = `${path}\0${name}\0${space}`;
    if (this.visiting.has(key)) return undefined;
    this.visiting.add(key);
    try {
      return this.model(path)?.exportValue(name, space);
    } finally {
      this.visiting.delete(key);
    }
  }

  names(path: string, seen = new Set<string>()): readonly string[] {
    if (seen.has(path)) return [];
    seen.add(path);
    const model = this.model(path);
    return model === undefined ? [] : model.exportNames(seen);
  }
}

export class FileModel {
  readonly sites: Site[] = [];
  private readonly sf: ts.SourceFile;
  private readonly top: Scope;
  private readonly exports = new Map<string, Exported>();
  private readonly stars: (() => string | null)[] = [];
  private readonly fns = new Map<ts.Node, Value>();
  private readonly classes = new Map<ts.Node, Value>();
  private readonly declared = new Map<ts.Node, () => Value | undefined>();
  private pending: Fn[] = [];

  constructor(
    private readonly registry: Registry,
    private readonly path: string,
    text: string,
  ) {
    this.sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    this.top = scopeOf(undefined, { returns: [], declared: undefined });
    this.hoist(this.sf.statements, this.top, true);
  }

  exportValue(name: string, space: Space): Value | undefined {
    const entry = this.exports.get(name);
    if (entry !== undefined) {
      if (entry.forward !== undefined) return entry.forward(space);
      const chosen = space === 'types' ? (entry.type ?? entry.value) : (entry.value ?? entry.type);
      return chosen === undefined ? undefined : force(chosen);
    }
    if (name === 'default') return undefined;
    for (const star of this.stars) {
      const found = this.registry.imported(star(), name, space);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  exportNames(seen: Set<string>): readonly string[] {
    const names = new Set(this.exports.keys());
    for (const star of this.stars) {
      const target = star();
      if (target !== null) for (const name of this.registry.names(target, seen)) if (name !== 'default') names.add(name);
    }
    return [...names];
  }

  analyze(): void {
    for (const statement of this.sf.statements) this.statement(statement, this.top);
    this.settle(this.top);
    this.drain();
  }

  private drain(): void {
    while (this.pending.length > 0) this.pending.shift()!.analyze();
  }

  private emit(act: Act, label: string, node: ts.Node): void {
    this.sites.push({ act, label, line: this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf)).line + 1 });
  }

  private settle(scope: Scope): void {
    for (const space of ['values', 'types'] as const) for (const slot of [...scope[space].values()]) force(slot);
  }

  private declare(scope: Scope, space: Space, name: string, thunk: () => Value | null | undefined): Slot {
    const made = slotOf({ thunk });
    scope[space].set(name, made);
    return made;
  }

  private declareTop(
    scope: Scope,
    spaces: readonly Space[],
    name: string,
    thunk: () => Value | null | undefined,
    exported: boolean,
    isDefault = false,
  ): void {
    const made: Exported = {};
    for (const space of spaces) {
      const preset = scope === this.top ? this.registry.sourceValue(this.path, name, space) : undefined;
      const one = preset === undefined ? this.declare(scope, space, name, thunk) : slotOf({ value: preset });
      if (preset !== undefined) scope[space].set(name, one);
      if (space === 'values') made.value = one;
      else made.type = one;
    }
    if (exported && scope === this.top) this.exports.set(isDefault ? 'default' : name, made);
  }

  private hoist(statements: readonly ts.Statement[], scope: Scope, top: boolean): void {
    const later: ts.ExportDeclaration[] = [];
    for (const statement of statements) {
      const exported = top && has(statement, ts.SyntaxKind.ExportKeyword);
      const isDefault = has(statement, ts.SyntaxKind.DefaultKeyword);
      if (ts.isImportDeclaration(statement)) this.importing(statement, scope);
      else if (ts.isImportEqualsDeclaration(statement)) this.requiring(statement, scope);
      else if (ts.isVariableStatement(statement))
        for (const one of statement.declarationList.declarations) this.variable(one, scope, exported);
      else if (ts.isFunctionDeclaration(statement)) {
        const name = statement.name?.text ?? (isDefault ? 'default' : undefined);
        if (name !== undefined) this.declareTop(scope, ['values'], name, () => this.fnValue(statement, scope), exported, isDefault);
      } else if (ts.isClassDeclaration(statement)) {
        const name = statement.name?.text ?? (isDefault ? 'default' : undefined);
        if (name !== undefined)
          this.declareTop(scope, ['values', 'types'], name, () => this.classValue(statement, scope), exported, isDefault);
      } else if (ts.isTypeAliasDeclaration(statement))
        this.declareTop(scope, ['types'], statement.name.text, () => this.typeValue(statement.type, scope), exported);
      else if (ts.isInterfaceDeclaration(statement))
        this.declareTop(scope, ['types'], statement.name.text, () => this.members(statement.members, scope), exported);
      else if (ts.isEnumDeclaration(statement)) this.declareTop(scope, ['values', 'types'], statement.name.text, () => null, exported);
      else if (top && ts.isExportDeclaration(statement)) later.push(statement);
      else if (top && ts.isExportAssignment(statement))
        this.exports.set('default', { value: slotOf({ thunk: once(() => this.eval(statement.expression, scope)) }) });
    }
    for (const statement of later) this.forwarding(statement, scope);
  }

  private importing(statement: ts.ImportDeclaration, scope: Scope): void {
    const spec = (statement.moduleSpecifier as ts.StringLiteral).text;
    const clause = statement.importClause;
    if (clause === undefined) return;
    const target = once(() => this.registry.resolve(spec, this.path));
    const bind = (local: string, name: string): void => {
      for (const space of ['values', 'types'] as const)
        scope[space].set(
          local,
          slotOf({ thunk: () => this.registry.imported(target(), name, space), from: { spec, name }, imported: true }),
        );
    };
    if (clause.name !== undefined) bind(clause.name.text, 'default');
    const bindings = clause.namedBindings;
    if (bindings === undefined) return;
    if (ts.isNamespaceImport(bindings)) {
      for (const space of ['values', 'types'] as const)
        scope[space].set(
          bindings.name.text,
          slotOf({
            thunk: () => {
              const path = target();
              return path === null ? undefined : { k: 'module', path };
            },
            from: { spec, name: '*' },
            imported: true,
          }),
        );
      return;
    }
    for (const one of bindings.elements) bind(one.name.text, (one.propertyName ?? one.name).text);
  }

  private requiring(statement: ts.ImportEqualsDeclaration, scope: Scope): void {
    if (!ts.isExternalModuleReference(statement.moduleReference) || !ts.isStringLiteralLike(statement.moduleReference.expression)) return;
    const spec = statement.moduleReference.expression.text;
    this.declare(scope, 'values', statement.name.text, () => {
      const path = this.registry.resolve(spec, this.path);
      return path === null ? undefined : { k: 'module', path };
    });
  }

  private forwarding(statement: ts.ExportDeclaration, scope: Scope): void {
    const clause = statement.exportClause;
    if (statement.moduleSpecifier === undefined || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      if (clause === undefined || !ts.isNamedExports(clause)) return;
      for (const one of clause.elements) {
        const local = (one.propertyName ?? one.name).text;
        this.exports.set(one.name.text, { value: scope.values.get(local), type: scope.types.get(local) });
      }
      return;
    }
    const spec = statement.moduleSpecifier.text;
    const target = once(() => this.registry.resolve(spec, this.path));
    if (clause === undefined) this.stars.push(target);
    else if (ts.isNamespaceExport(clause))
      this.exports.set(clause.name.text, {
        value: slotOf({
          thunk: () => {
            const path = target();
            return path === null ? undefined : { k: 'module', path };
          },
        }),
      });
    else
      for (const one of clause.elements)
        this.exports.set(one.name.text, {
          forward: (space) => this.registry.imported(target(), (one.propertyName ?? one.name).text, space),
        });
  }

  private variable(declaration: ts.VariableDeclaration, scope: Scope, exported: boolean): void {
    const whole = once(() => {
      const annotated = declaration.type === undefined ? undefined : this.typeValue(declaration.type, scope);
      const inferred = declaration.initializer === undefined ? undefined : this.eval(declaration.initializer, scope, annotated);
      return annotated ?? inferred;
    });
    this.declared.set(declaration, whole);
    if (ts.isIdentifier(declaration.name)) {
      this.declareTop(scope, ['values'], declaration.name.text, whole, exported);
      return;
    }
    this.pattern(declaration.name, whole, scope, exported);
  }

  private pattern(name: ts.BindingName, source: () => Value | undefined, scope: Scope, exported: boolean): void {
    if (ts.isIdentifier(name)) {
      this.declareTop(scope, ['values'], name.text, source, exported);
      return;
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        const key = element.propertyName === undefined ? nameOf(element.name) : nameOf(element.propertyName);
        const one = once(() => (key === undefined ? undefined : this.member(source(), key)));
        if (element.initializer !== undefined) this.eval(element.initializer, scope);
        this.pattern(element.name, element.dotDotDotToken === undefined ? one : source, scope, exported);
      }
      return;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const one = once(() => {
        const held = source();
        return held?.k === 'array' ? held.of : undefined;
      });
      this.pattern(element.name, one, scope, exported);
    }
  }

  private bind(name: ts.BindingName, value: Value | undefined, scope: Scope): void {
    this.pattern(name, () => value, scope, false);
  }

  private member(base: Value | undefined, name: string, node?: ts.Node): Value | undefined {
    if (base === undefined) return undefined;
    switch (base.k) {
      case 'cap': {
        const methods = METHODS[base.cap];
        return Object.hasOwn(methods, name) ? { k: 'method', cap: base.cap, name } : undefined;
      }
      case 'object':
        return base.props.get(name);
      case 'module': {
        const found = this.registry.imported(base.path, name, 'values');
        if (node !== undefined && rowBearing(found)) this.emit('row', `harness row ${name}`, node);
        return found;
      }
      default:
        return undefined;
    }
  }

  private statement(node: ts.Node, scope: Scope): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return;
    if (ts.isVariableStatement(node)) {
      for (const one of node.declarationList.declarations) this.declaredIn(one, scope);
      return;
    }
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? 'default';
      const held = scope.values.get(name);
      if (held !== undefined) force(held);
      return;
    }
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const held = scope.types.get(node.name.text);
      if (held !== undefined) force(held);
      return;
    }
    if (ts.isReturnStatement(node)) {
      scope.frame.returns.push(node.expression === undefined ? undefined : this.eval(node.expression, scope, scope.frame.declared));
      return;
    }
    if (ts.isBlock(node)) {
      this.scoped(node.statements, scope);
      return;
    }
    if (ts.isExpressionStatement(node)) {
      this.eval(node.expression, scope);
      return;
    }
    if (ts.isIfStatement(node)) {
      this.eval(node.expression, scope);
      this.statement(node.thenStatement, scope);
      if (node.elseStatement !== undefined) this.statement(node.elseStatement, scope);
      return;
    }
    if (ts.isForStatement(node)) {
      const inner = scopeOf(scope, scope.frame);
      if (node.initializer !== undefined) this.loopHead(node.initializer, inner);
      if (node.condition !== undefined) this.eval(node.condition, inner);
      if (node.incrementor !== undefined) this.eval(node.incrementor, inner);
      this.statement(node.statement, inner);
      return;
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const inner = scopeOf(scope, scope.frame);
      const source = this.eval(node.expression, scope);
      const element = ts.isForOfStatement(node) && source?.k === 'array' ? source.of : undefined;
      if (ts.isVariableDeclarationList(node.initializer))
        for (const one of node.initializer.declarations) this.bind(one.name, element, inner);
      else this.eval(node.initializer, inner);
      this.statement(node.statement, inner);
      return;
    }
    if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      this.eval(node.expression, scope);
      this.statement(node.statement, scope);
      return;
    }
    if (ts.isTryStatement(node)) {
      this.statement(node.tryBlock, scope);
      if (node.catchClause !== undefined) {
        const inner = scopeOf(scope, scope.frame);
        if (node.catchClause.variableDeclaration !== undefined) this.bind(node.catchClause.variableDeclaration.name, undefined, inner);
        this.statement(node.catchClause.block, inner);
      }
      if (node.finallyBlock !== undefined) this.statement(node.finallyBlock, scope);
      return;
    }
    if (ts.isSwitchStatement(node)) {
      this.eval(node.expression, scope);
      const inner = scopeOf(scope, scope.frame);
      const all = node.caseBlock.clauses.flatMap((one) => [...one.statements]);
      this.hoist(all, inner, false);
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) this.eval(clause.expression, inner);
        for (const one of clause.statements) this.statement(one, inner);
      }
      this.settle(inner);
      return;
    }
    if (ts.isLabeledStatement(node)) {
      this.statement(node.statement, scope);
      return;
    }
    if (ts.isThrowStatement(node)) {
      if (node.expression !== undefined) this.eval(node.expression, scope);
      return;
    }
    if (ts.isModuleDeclaration(node) || ts.isEnumDeclaration(node)) return;
    ts.forEachChild(node, (child) => (ts.isStatement(child) ? this.statement(child, scope) : this.eval(child, scope)));
  }

  private declaredIn(declaration: ts.VariableDeclaration, scope: Scope): void {
    const root = this.declared.get(declaration);
    if (root !== undefined) root();
    const names: ts.Identifier[] = [];
    const collect = (name: ts.BindingName): void => {
      if (ts.isIdentifier(name)) names.push(name);
      else for (const element of name.elements) if (!ts.isOmittedExpression(element)) collect(element.name);
    };
    collect(declaration.name);
    for (const one of names) {
      const held = scope.values.get(one.text);
      if (held !== undefined) force(held);
    }
  }

  private loopHead(initializer: ts.ForInitializer, scope: Scope): void {
    if (ts.isVariableDeclarationList(initializer)) {
      for (const one of initializer.declarations) this.variable(one, scope, false);
      for (const one of initializer.declarations) this.declaredIn(one, scope);
    } else this.eval(initializer, scope);
  }

  private scoped(statements: readonly ts.Statement[], parent: Scope): void {
    const inner = scopeOf(parent, parent.frame);
    this.hoist(statements, inner, false);
    for (const one of statements) this.statement(one, inner);
    this.settle(inner);
  }

  private fnValue(node: ts.SignatureDeclaration, scope: Scope, context?: Value): Value {
    const held = this.fns.get(node);
    if (held !== undefined) return held;
    const given = context?.k === 'fn' ? context.fn.params : [];
    const params = node.parameters.map((one, at) => (one.type === undefined ? given[at] : this.typeValue(one.type, scope)) ?? undefined);
    const declared = node.type === undefined ? undefined : this.typeValue(node.type, scope);
    let started = false;
    const fn: Fn = {
      params,
      returns: declared,
      analyze: () => {
        if (started) return;
        started = true;
        const frame: Frame = { returns: [], declared: declared ?? (context?.k === 'fn' ? context.fn.returns : undefined) };
        const inner = scopeOf(scope, frame);
        node.parameters.forEach((one, at) => {
          if (one.initializer !== undefined) this.eval(one.initializer, inner, params[at]);
          this.bind(one.name, params[at], inner);
        });
        const body = (node as ts.FunctionLikeDeclaration).body;
        if (body !== undefined && ts.isBlock(body)) {
          this.hoist(body.statements, inner, false);
          for (const one of body.statements) this.statement(one, inner);
          this.settle(inner);
        } else if (body !== undefined) frame.returns.push(this.eval(body, inner, frame.declared));
        if (declared === undefined) fn.returns = frame.returns.find((one) => one !== undefined);
      },
    };
    const value: Value = { k: 'fn', fn };
    this.fns.set(node, value);
    this.pending.push(fn);
    return value;
  }

  private classValue(node: ts.ClassLikeDeclaration, scope: Scope): Value {
    const held = this.classes.get(node);
    if (held !== undefined) return held;
    const props = new Map<string, Value>();
    const value: Value = { k: 'object', props };
    this.classes.set(node, value);
    const inner = scopeOf(scope, scope.frame);
    inner.thisValue = value;
    for (const clause of node.heritageClauses ?? []) {
      for (const one of clause.types) {
        one.typeArguments?.forEach((argument) => this.typeValue(argument, scope));
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) this.eval(one.expression, scope);
      }
    }
    for (const member of node.members) {
      if (ts.isConstructorDeclaration(member)) {
        for (const parameter of member.parameters) {
          const modifiers = ts.canHaveModifiers(parameter) ? (ts.getModifiers(parameter) ?? []) : [];
          const name = nameOf(parameter.name);
          if (modifiers.length > 0 && name !== undefined && parameter.type !== undefined) {
            const typed = this.typeValue(parameter.type, scope);
            if (typed !== undefined) props.set(name, typed);
          }
        }
        this.returned(this.fnValue(member, inner));
      }
    }
    for (const member of node.members) {
      const name = nameOf(member.name);
      if (ts.isPropertyDeclaration(member)) {
        const typed = member.type === undefined ? undefined : this.typeValue(member.type, scope);
        const given = typed ?? (member.initializer === undefined ? undefined : this.eval(member.initializer, inner));
        if (name !== undefined && given !== undefined) props.set(name, given);
      } else if (ts.isMethodDeclaration(member)) {
        const made = this.fnValue(member, inner);
        if (name !== undefined) props.set(name, made);
      } else if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) this.fnValue(member, inner);
    }
    return value;
  }

  private members(members: readonly ts.TypeElement[], scope: Scope): Value {
    const props = new Map<string, Value>();
    for (const member of members) {
      const name = nameOf(member.name);
      if (ts.isPropertySignature(member)) {
        const typed = member.type === undefined ? undefined : this.typeValue(member.type, scope);
        if (name !== undefined && typed !== undefined) props.set(name, typed);
      } else if (ts.isMethodSignature(member)) {
        const params = member.parameters.map((one) => (one.type === undefined ? undefined : this.typeValue(one.type, scope)));
        const returns = member.type === undefined ? undefined : this.typeValue(member.type, scope);
        if (name !== undefined) props.set(name, { k: 'fn', fn: { params, returns, analyze: () => undefined } });
      } else ts.forEachChild(member, (child) => (ts.isTypeNode(child) ? this.typeValue(child, scope) : undefined));
    }
    return { k: 'object', props };
  }

  private typeValue(node: ts.TypeNode, scope: Scope): Value | undefined {
    if (ts.isTypeReferenceNode(node)) return this.reference(node, scope);
    if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) return this.typeValue(node.type, scope);
    if (ts.isArrayTypeNode(node)) {
      const of = this.typeValue(node.elementType, scope);
      return of === undefined ? undefined : { k: 'array', of };
    }
    if (ts.isTupleTypeNode(node)) {
      const all = node.elements.map((one) => this.typeValue(ts.isNamedTupleMember(one) ? one.type : one, scope));
      const of = all.find((one) => one !== undefined);
      return of === undefined ? undefined : { k: 'array', of };
    }
    if (ts.isUnionTypeNode(node)) return node.types.map((one) => this.typeValue(one, scope)).find((one) => one !== undefined);
    if (ts.isIntersectionTypeNode(node)) {
      const all = node.types.map((one) => this.typeValue(one, scope)).filter((one): one is Value => one !== undefined);
      return all.find((one) => one.k === 'cap' && one.cap === 'access') ?? all[0];
    }
    if (ts.isTypeLiteralNode(node)) return this.members(node.members, scope);
    if (ts.isFunctionTypeNode(node)) {
      const params = node.parameters.map((one) => (one.type === undefined ? undefined : this.typeValue(one.type, scope)));
      return { k: 'fn', fn: { params, returns: this.typeValue(node.type, scope), analyze: () => undefined } };
    }
    if (ts.isIndexedAccessTypeNode(node)) {
      const base = this.typeValue(node.objectType, scope);
      const index =
        ts.isLiteralTypeNode(node.indexType) && ts.isStringLiteralLike(node.indexType.literal) ? node.indexType.literal.text : undefined;
      if (index === undefined) {
        this.typeValue(node.indexType, scope);
        return base?.k === 'array' ? base.of : undefined;
      }
      if (base?.k === 'service' && index === 'Service') return { k: 'cap', cap: base.cap };
      return this.member(base, index);
    }
    if (ts.isTypeQueryNode(node)) {
      const root = ts.isIdentifier(node.exprName) ? node.exprName : undefined;
      const held = root === undefined ? undefined : find(scope, root.text, 'values');
      return held === undefined ? undefined : unwrap(force(held));
    }
    ts.forEachChild(node, (child) => (ts.isTypeNode(child) ? this.typeValue(child, scope) : undefined));
    return undefined;
  }

  private reference(node: ts.TypeReferenceNode, scope: Scope): Value | undefined {
    const name = ts.isIdentifier(node.typeName) ? node.typeName : node.typeName.right;
    const args = (node.typeArguments ?? []).map((one) => this.typeValue(one, scope));
    if ((WRAPPED.has(name.text) || (name.text === 'Shape' && ts.isQualifiedName(node.typeName))) && args.length > 0) return args[0];
    if (ARRAYS.has(name.text) && args.length > 0) return args[0] === undefined ? undefined : { k: 'array', of: args[0] };
    if (ts.isIdentifier(node.typeName)) {
      const held = find(scope, name.text, 'types');
      if (held === undefined) return undefined;
      const value = force(held);
      if (held.imported && rowBearing(value)) this.emit('row', `harness row ${held.from?.name ?? name.text}`, node);
      return value;
    }
    const left = ts.isIdentifier(node.typeName.left) ? node.typeName.left : undefined;
    const held = left === undefined ? undefined : find(scope, left.text, 'values');
    const base = held === undefined ? undefined : force(held);
    if (base?.k !== 'module') return undefined;
    const value = this.registry.imported(base.path, name.text, 'types');
    if (rowBearing(value)) this.emit('row', `harness row ${name.text}`, node);
    return value;
  }

  private namespaceOf(node: ts.Expression, scope: Scope): string | undefined {
    if (!ts.isIdentifier(node)) return undefined;
    const from = find(scope, node.text, 'values')?.from;
    if (from === undefined) return undefined;
    if (from.spec === 'effect') return ['Effect', 'Context', 'Layer'].includes(from.name) ? from.name : undefined;
    if (from.spec.startsWith('effect/') && from.name === '*') return from.spec.slice('effect/'.length);
    return undefined;
  }

  eval(node: ts.Node, scope: Scope, context?: Value): Value | undefined {
    if (ts.isIdentifier(node)) return this.identifier(node, scope);
    if (node.kind === ts.SyntaxKind.ThisKeyword) return thisOf(scope);
    if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return this.eval(node.expression, scope, context);
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const inner = this.eval(node.expression, scope);
      return this.typeValue(node.type, scope) ?? inner;
    }
    if (ts.isSatisfiesExpression(node)) {
      const typed = this.typeValue(node.type, scope);
      return this.eval(node.expression, scope, typed);
    }
    if (ts.isAwaitExpression(node)) return this.eval(node.expression, scope);
    if (ts.isYieldExpression(node)) return node.expression === undefined ? undefined : unwrap(this.eval(node.expression, scope));
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return this.access(node, scope);
    if (ts.isCallExpression(node)) return this.call(node, scope);
    if (ts.isNewExpression(node)) {
      const made = this.eval(node.expression, scope);
      node.typeArguments?.forEach((one) => this.typeValue(one, scope));
      for (const argument of node.arguments ?? []) this.eval(argument, scope);
      return made?.k === 'object' ? made : undefined;
    }
    if (ts.isObjectLiteralExpression(node)) return this.literal(node, scope, context);
    if (ts.isArrayLiteralExpression(node)) {
      const all = node.elements.map((one) => this.eval(one, scope));
      const first = all.find((one) => one !== undefined);
      return first === undefined ? undefined : first.k === 'array' ? first : { k: 'array', of: first };
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return this.fnValue(node, scope, context);
    if (ts.isClassExpression(node)) return this.classValue(node, scope);
    if (ts.isSpreadElement(node)) return this.eval(node.expression, scope);
    if (ts.isConditionalExpression(node)) {
      this.eval(node.condition, scope);
      const yes = this.eval(node.whenTrue, scope, context);
      return yes ?? this.eval(node.whenFalse, scope, context);
    }
    if (ts.isBinaryExpression(node)) return this.binary(node, scope);
    ts.forEachChild(node, (child) => (ts.isTypeNode(child) ? this.typeValue(child, scope) : this.eval(child, scope)));
    return undefined;
  }

  private identifier(node: ts.Identifier, scope: Scope): Value | undefined {
    const held = find(scope, node.text, 'values');
    if (held === undefined) return undefined;
    const value = force(held);
    if (held.imported && rowBearing(value)) this.emit('row', `harness row ${held.from?.name ?? node.text}`, node);
    return value;
  }

  private access(node: ts.PropertyAccessExpression | ts.ElementAccessExpression, scope: Scope): Value | undefined {
    const base = this.eval(node.expression, scope);
    if (ts.isPropertyAccessExpression(node)) return this.member(base, node.name.text, node);
    const name = literalOf(node.argumentExpression);
    if (name === undefined) {
      this.eval(node.argumentExpression, scope);
      return base?.k === 'array' ? base.of : undefined;
    }
    return this.member(base, name, node);
  }

  private binary(node: ts.BinaryExpression, scope: Scope): Value | undefined {
    const kind = node.operatorToken.kind;
    if (kind === ts.SyntaxKind.EqualsToken) {
      const right = this.eval(node.right, scope);
      const left = node.left;
      if (ts.isIdentifier(left)) {
        const held = find(scope, left.text, 'values');
        if (held !== undefined && held.value == null && held.thunk === undefined && right !== undefined) held.value = right;
      } else if (ts.isPropertyAccessExpression(left) && left.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const self = thisOf(scope);
        if (self?.k === 'object' && right !== undefined && !self.props.has(left.name.text)) self.props.set(left.name.text, right);
      } else this.eval(left, scope);
      return right;
    }
    const left = this.eval(node.left, scope);
    const right = this.eval(node.right, scope);
    if (kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.BarBarToken) return left ?? right;
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken || kind === ts.SyntaxKind.CommaToken) return right;
    return undefined;
  }

  private literal(node: ts.ObjectLiteralExpression, scope: Scope, context?: Value): Value {
    const props = new Map<string, Value>();
    const shape = context?.k === 'object' ? context.props : undefined;
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = this.eval(property.expression, scope);
        if (spread?.k === 'object') for (const [name, one] of spread.props) props.set(name, one);
        continue;
      }
      if (property.name !== undefined && ts.isComputedPropertyName(property.name)) this.eval(property.name.expression, scope);
      const name = nameOf(property.name);
      const given = name === undefined ? undefined : shape?.get(name);
      let value: Value | undefined;
      if (ts.isPropertyAssignment(property)) value = this.eval(property.initializer, scope, given);
      else if (ts.isShorthandPropertyAssignment(property)) value = this.identifier(property.name, scope);
      else if (ts.isMethodDeclaration(property)) value = this.fnValue(property, scope, given);
      else if (ts.isGetAccessor(property) || ts.isSetAccessor(property)) this.fnValue(property, scope);
      if (name !== undefined && value !== undefined) props.set(name, value);
    }
    return { k: 'object', props };
  }

  private call(node: ts.CallExpression, scope: Scope): Value | undefined {
    const callee = node.expression;
    node.typeArguments?.forEach((one) => this.typeValue(one, scope));
    if (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && callee.text === 'require' && find(scope, 'require', 'values') === undefined)
    ) {
      const first = node.arguments[0];
      for (const one of node.arguments) this.eval(one, scope);
      const spec = first === undefined ? undefined : literalOf(first);
      const path = spec === undefined ? null : this.registry.resolve(spec, this.path);
      return path === null ? undefined : { k: 'module', path };
    }
    if (
      ts.isPropertyAccessExpression(callee) ||
      (ts.isElementAccessExpression(callee) && literalOf(callee.argumentExpression) !== undefined)
    ) {
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : literalOf((callee as ts.ElementAccessExpression).argumentExpression)!;
      const space = this.namespaceOf(callee.expression, scope);
      if (space !== undefined) return this.combinator(`${space}.${name}`, node, scope);
      if (name === 'pipe') return this.pipe(node, callee.expression, scope);
      return this.invoke(this.eval(callee.expression, scope), name, callee, node, scope);
    }
    return this.apply(this.eval(callee, scope), node, scope);
  }

  private args(node: ts.CallExpression, scope: Scope, contexts: readonly (Value | undefined)[] = []): (Value | undefined)[] {
    return node.arguments.map((one, at) => this.eval(one, scope, contexts[at]));
  }

  private apply(value: Value | undefined, node: ts.CallExpression, scope: Scope): Value | undefined {
    return this.fire(value, this.args(node, scope, value?.k === 'fn' ? value.fn.params : []), node);
  }

  private fire(value: Value | undefined, args: readonly (Value | undefined)[], node: ts.Node): Value | undefined {
    if (value === undefined) return undefined;
    if (value.k === 'method') {
      const method = METHODS[value.cap][value.name]!;
      if (method.act !== null) this.emit(method.act, labelOf(value.cap, value.name), node);
      return method.returns ?? undefined;
    }
    if (value.k === 'fn') {
      value.fn.analyze();
      if (rowBearing(value.fn.returns)) this.emit('row', 'harness row', node);
      return value.fn.returns;
    }
    return value.k === 'wrap' ? args[0] : undefined;
  }

  private invoke(base: Value | undefined, name: string, callee: ts.Expression, node: ts.CallExpression, scope: Scope): Value | undefined {
    if (base === undefined) {
      this.args(node, scope);
      return undefined;
    }
    if ((base.k === 'method' || base.k === 'fn') && (name === 'bind' || name === 'call' || name === 'apply')) {
      const args = this.args(node, scope);
      return name === 'bind' ? base : this.fire(base, args, node);
    }
    if (base.k === 'service') {
      if (name === 'use') return this.returned(this.args(node, scope, [callbackOf([{ k: 'cap', cap: base.cap }])])[0]);
      this.args(node, scope);
      return undefined;
    }
    if (base.k === 'array') return this.arrays(base, name, node, scope);
    return this.apply(this.member(base, name, callee), node, scope);
  }

  private returned(value: Value | undefined): Value | undefined {
    if (value?.k !== 'fn') return undefined;
    value.fn.analyze();
    return value.fn.returns;
  }

  private arrays(base: Value & { readonly k: 'array' }, name: string, node: ts.CallExpression, scope: Scope): Value | undefined {
    const each = [callbackOf([base.of, undefined])];
    const reduced = [callbackOf([undefined, base.of])];
    const args = this.args(node, scope, name === 'reduce' ? reduced : each);
    const callback = args[0];
    const returned = callback?.k === 'fn' ? (callback.fn.analyze(), callback.fn.returns) : undefined;
    switch (name) {
      case 'map':
        return returned === undefined ? undefined : { k: 'array', of: returned };
      case 'flatMap':
        return returned === undefined ? undefined : returned.k === 'array' ? returned : { k: 'array', of: returned };
      case 'filter':
      case 'sort':
      case 'slice':
      case 'concat':
      case 'toSorted':
      case 'toReversed':
      case 'reverse':
        return base;
      case 'find':
      case 'findLast':
      case 'at':
      case 'pop':
      case 'shift':
        return base.of;
      default:
        return undefined;
    }
  }

  private combinator(name: string, node: ts.CallExpression, scope: Scope): Value | undefined {
    const first = node.arguments[0];
    switch (name) {
      case 'Effect.gen': {
        const values = this.args(node, scope);
        const body = values[values.length - 1];
        return body?.k === 'fn' ? (body.fn.analyze(), body.fn.returns) : undefined;
      }
      case 'Effect.fn': {
        const values = this.args(node, scope);
        return first !== undefined && (ts.isFunctionExpression(first) || ts.isArrowFunction(first)) ? values[0] : { k: 'wrap' };
      }
      case 'Effect.fnUntraced':
        return this.args(node, scope)[0];
      case 'Effect.service':
        return unwrap(this.args(node, scope)[0]);
      case 'Effect.flatMap':
      case 'Effect.map':
      case 'Effect.andThen':
      case 'Effect.tap': {
        if (node.arguments.length < 2) {
          this.args(node, scope);
          return undefined;
        }
        const subject = this.eval(node.arguments[0]!, scope);
        const callback = this.eval(node.arguments[1]!, scope, callbackOf([unwrap(subject)]));
        node.arguments.slice(2).forEach((one) => this.eval(one, scope));
        if (name === 'Effect.tap') return subject;
        return callback?.k === 'fn' ? (callback.fn.analyze(), callback.fn.returns) : undefined;
      }
      case 'Context.get':
      case 'Context.getUnsafe':
      case 'Context.unsafeGet':
      case 'Context.getOrElse': {
        const service = this.args(node, scope).find((one) => one?.k === 'service');
        return service === undefined ? undefined : unwrap(service);
      }
      default:
        this.args(node, scope);
        return undefined;
    }
  }

  private pipe(node: ts.CallExpression, receiver: ts.Expression, scope: Scope): Value | undefined {
    let current = this.eval(receiver, scope);
    for (const operation of node.arguments) {
      if (ts.isCallExpression(operation) && ts.isPropertyAccessExpression(operation.expression)) {
        const space = this.namespaceOf(operation.expression.expression, scope);
        const name = operation.expression.name.text;
        if (space === 'Effect' && (THEN.has(name) || name === 'tap') && operation.arguments.length === 1) {
          const callback = this.eval(operation.arguments[0]!, scope, callbackOf([unwrap(current)]));
          if (name !== 'tap') current = callback?.k === 'fn' ? (callback.fn.analyze(), callback.fn.returns) : undefined;
          continue;
        }
        if (space === 'Effect' && PRESERVING.has(name)) {
          this.args(operation, scope);
          continue;
        }
      }
      this.eval(operation, scope);
      current = undefined;
    }
    return current;
  }
}
