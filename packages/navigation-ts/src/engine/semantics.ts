import { posix } from 'node:path';
import type { Judgement, Judging, Located, Spot, Subject } from '@runlith/navigation/adapter';
import type { Place, Position, UnverifiedReason, UseKind, Verdict } from '@runlith/navigation/verdict';
import {
  type Declaration,
  type Node,
  type SourceFile,
  SyntaxKind as K,
  getNameOfDeclaration,
  getTouchingPropertyName,
  isIdentifier,
} from 'typescript7/ast';
import { type NodeHandle, type Project, SymbolFlags, type Symbol as TsSymbol, type Type, TypeFlags } from 'typescript7/async';
import type { Asked } from '../wire';
import { accessOf, declarationOf, inImport, isMemberName, type Name, offsetOf, placeOf, spotAt, useOf, within } from './syntax';
import type { Apart, View } from './view';

type Spotting = { readonly abs: string; readonly offset: number };

type Role = 'subject' | 'alias' | 'implementation';

type Identity = {
  readonly name: string;
  readonly keys: readonly string[];
  readonly spots: readonly Spotting[];
  readonly role: Role;
  readonly depth: number;
  readonly origin: string | null;
};

type Entry = {
  readonly at: number;
  readonly node: Name;
  symbol: TsSymbol | undefined;
};

type Loaded = {
  readonly project: Project;
  readonly source: SourceFile;
  readonly entries: readonly Entry[];
};

type Flow = { readonly local: TsSymbol; readonly role: 'alias' | 'implementation'; readonly marks: boolean; readonly named: Node };

type Judged = {
  readonly identity: Identity;
  readonly keys: ReadonlySet<string>;
  readonly cut: ReadonlySet<string>;
  readonly aliased: ReadonlySet<number>;
  readonly severed: ReadonlySet<number>;
  readonly discovered: ReadonlyMap<string, UseKind>;
  readonly basis: Set<string>;
};

const LOCALS = new Set<K>([K.VariableDeclaration, K.BindingElement, K.Parameter]);

const ALIAS_DEPTH = 2;

const APART = '(programs without its declaration)';

const LITERAL = '(object literals)';

const keyOf = (handle: NodeHandle): string => `${handle.path}#${handle.index}`;

const keysOf = (symbol: TsSymbol | undefined): readonly string[] => symbol?.declarations.map(keyOf) ?? [];

const encode = (identity: Identity): string => JSON.stringify(identity);

const decode = (id: string): Identity => JSON.parse(id) as Identity;

const unverified = (reason: UnverifiedReason): Verdict => ({ _tag: 'unverified', reason });

const use = (kind: UseKind, within: string | null): Verdict => ({ _tag: 'use', kind, within });

const vague = (type: Type | undefined): boolean =>
  type === undefined || (type.flags & (TypeFlags.Any | TypeFlags.Unknown)) !== 0 || type.isErrorType();

const nameText = (node: Node, source: SourceFile): string =>
  isIdentifier(node)
    ? node.text
    : node.kind === K.StringLiteral
      ? (node as Node & { text: string }).text
      : source.text.slice(node.getStart(source), node.end);

const ROLES: Readonly<Record<Role, UseKind>> = { subject: 'declaration', alias: 'alias', implementation: 'implementation' };

const paced = async <A, B>(items: readonly A[], pace: number, work: (item: A) => Promise<B>): Promise<B[]> => {
  const done: B[] = [];
  for (let at = 0; at < items.length; at += pace) done.push(...(await Promise.all(items.slice(at, at + pace).map(work))));
  return done;
};

export const makeSemantics = (view: View) => {
  const { catalog } = view;
  const canonical = new Map<string, Promise<TsSymbol>>();
  const labels = new Map<string, Promise<string>>();
  const owners = new Map<string, Promise<ReadonlySet<string> | undefined>>();

  const resolve = (project: Project, symbol: TsSymbol | undefined): Promise<TsSymbol | undefined> => {
    if (symbol === undefined || (symbol.flags & SymbolFlags.Alias) === 0) return Promise.resolve(symbol);
    const key = `${project.id}\0${symbol.id}`;
    let found = canonical.get(key);
    if (found === undefined) {
      found = project.checker.getAliasedSymbol(symbol);
      canonical.set(key, found);
    }
    return found;
  };

  const symbolsAt = async (project: Project, nodes: readonly Node[]): Promise<(TsSymbol | undefined)[]> => {
    if (nodes.length === 0) return [];
    const found = await project.checker.getSymbolAtLocation(nodes);
    return Promise.all(found.map((symbol) => resolve(project, symbol)));
  };

  const placeAt = (source: SourceFile, node: Node): Place => {
    const offset = node.getStart(source);
    return { path: catalog.relative(source.fileName), ...placeOf(source, offset) };
  };

  const declarationsOf = async (project: Project, symbol: TsSymbol) => {
    const nodes = await Promise.all(symbol.declarations.map((handle) => handle.resolve(project)));
    return nodes.flatMap((node) => {
      if (node === undefined) return [];
      const name = getNameOfDeclaration(node as Declaration) ?? node;
      const source = name.getSourceFile();
      return [{ place: placeAt(source, name), spot: { abs: source.fileName, offset: name.getStart(source) } }];
    });
  };

  const subjectOf = async (
    project: Project,
    symbol: TsSymbol,
    line: number,
    identity: Omit<Identity, 'keys' | 'spots'>,
    extra: readonly string[],
  ) => {
    const declarations = await declarationsOf(project, symbol);
    const full: Identity = { ...identity, keys: [...keysOf(symbol), ...extra], spots: declarations.map((one) => one.spot) };
    return { id: encode(full), name: identity.name, line, declarations: declarations.map((one) => one.place) } satisfies Subject;
  };

  const placesOf = async (spots: readonly Spotting[]): Promise<readonly Place[]> => {
    const places = await Promise.all(
      spots.map(async (spot) => {
        const project = view.projectFor(spot.abs, []);
        const source = project === undefined ? undefined : await project.program.getSourceFile(spot.abs);
        return source === undefined ? [] : [{ path: catalog.relative(source.fileName), ...placeOf(source, spot.offset) }];
      }),
    );
    return places.flat();
  };

  const rely = (basis: Set<string>, symbol: TsSymbol | undefined) => {
    for (const handle of symbol?.declarations ?? []) {
      const file = catalog.real(handle.path);
      if (file !== undefined) basis.add(catalog.relative(file));
    }
  };

  const contextual = async (project: Project, literal: Node, name: string): Promise<TsSymbol | undefined | null> => {
    const type = await project.checker.getContextualType(literal as never);
    if (vague(type) || type === undefined) return null;
    return resolve(project, await project.checker.getPropertyOfType(type, name));
  };

  const fresh = async (project: Project, literal: Node, own: TsSymbol): Promise<boolean> => {
    const property = await contextual(project, literal, own.name);
    if (property === null || property === undefined) return true;
    const mine = new Set(keysOf(own));
    return keysOf(property).every((key) => mine.has(key));
  };

  const implemented = async (project: Project, member: Node, name: string): Promise<readonly TsSymbol[]> => {
    const owner = member.parent as Node & { heritageClauses?: readonly (Node & { types: readonly Node[] })[] };
    const types = (owner.heritageClauses ?? []).flatMap((clause) => clause.types);
    const found = await Promise.all(
      types.map(async (typeNode) => {
        const type = await project.checker.getTypeAtLocation(typeNode);
        return vague(type) ? undefined : resolve(project, await project.checker.getPropertyOfType(type, name));
      }),
    );
    return found.filter((symbol) => symbol !== undefined);
  };

  const label = (project: Project, symbol: TsSymbol): Promise<string> => {
    const key = `${project.id}\0${symbol.id}`;
    let found = labels.get(key);
    if (found === undefined) {
      found = symbol.getParent().then((parent) => {
        if (parent !== undefined && !parent.name.startsWith('__') && !parent.name.startsWith('"')) return `${parent.name}.${symbol.name}`;
        if (parent?.name === '__object') return LITERAL;
        const declared = symbol.declarations[0];
        return declared === undefined ? symbol.name : `${posix.basename(declared.path)}:${symbol.name}`;
      });
      labels.set(key, found);
    }
    return found;
  };

  const ownerNames = (identity: Identity): Promise<ReadonlySet<string> | undefined> => {
    const spot = identity.spots[0];
    if (spot === undefined) return Promise.resolve(undefined);
    let found = owners.get(identity.keys.join('|'));
    if (found === undefined) {
      found = (async () => {
        const project = view.projectFor(spot.abs, []);
        if (project === undefined) return undefined;
        const source = await project.program.getSourceFile(spot.abs);
        const owner = source === undefined ? undefined : declarationOf(getTouchingPropertyName(source, spot.offset))?.parent;
        if (owner === undefined) return undefined;
        const named = getNameOfDeclaration(owner as Declaration);
        const symbol = named === undefined ? undefined : (await symbolsAt(project, [named]))[0];
        const type =
          symbol !== undefined && (symbol.flags & (SymbolFlags.Class | SymbolFlags.Interface)) !== 0
            ? await project.checker.getDeclaredTypeOfSymbol(symbol)
            : await project.checker.getTypeAtLocation(owner);
        if (vague(type)) return undefined;
        const members = await project.checker.getPropertiesOfType(type);
        return new Set(members.filter((member) => (member.flags & SymbolFlags.Optional) === 0).map((member) => member.name));
      })();
      owners.set(identity.keys.join('|'), found);
    }
    return found;
  };

  const load = async (
    abs: string,
    project: Project | Apart | undefined,
    positions: readonly { readonly at: number; readonly position: Position }[],
    name: string,
    verdicts: Verdict[],
  ) => {
    const all = (verdict: Verdict) => {
      for (const { at } of positions) verdicts[at] = verdict;
      return undefined;
    };
    if (project === undefined || project === 'none') return all(unverified('no-program'));
    if (project === 'apart') return all({ _tag: 'other', symbol: APART });
    if (project === 'linked') return all(unverified('unclear'));
    if (project === 'degraded') return all(unverified('degraded'));
    const source = await project.program.getSourceFile(abs);
    if (source === undefined) return all(unverified('no-program'));
    const entries: Entry[] = [];
    for (const { at, position } of positions) {
      const offset = offsetOf(source, position.line, position.column);
      const spotted = offset === undefined ? ({ _tag: 'moved' } as const) : spotAt(source, offset, name);
      if (spotted._tag === 'text') verdicts[at] = { _tag: 'text' };
      else if (spotted._tag === 'moved') verdicts[at] = unverified('unclear');
      else entries.push({ at, node: spotted.node, symbol: undefined });
    }
    const symbols = await symbolsAt(
      project,
      entries.map((entry) => entry.node),
    );
    entries.forEach((entry, index) => {
      entry.symbol = symbols[index];
    });
    return { project, source, entries } satisfies Loaded;
  };

  const localAt = async (project: Project, name: Node | undefined, role: Flow['role'], marks: boolean): Promise<Flow | undefined> => {
    if (name === undefined || !isIdentifier(name)) return undefined;
    const [local] = await project.checker.getSymbolAtLocation([name]);
    return local === undefined ? undefined : { local, role, marks, named: name };
  };

  const flows = async (file: Loaded, entry: Entry, hits: (symbol: TsSymbol | undefined) => boolean): Promise<Flow | undefined> => {
    const { project, source } = file;
    const node = entry.node;
    const parent = node.parent;
    if (parent.kind === K.BindingElement) {
      const binding = parent as Node & { propertyName?: Node; name?: Node; parent: Node };
      const property = binding.propertyName ?? binding.name;
      if (property !== node || binding.parent.kind !== K.ObjectBindingPattern) return undefined;
      const type = await project.checker.getTypeAtLocation(binding.parent);
      if (vague(type)) return undefined;
      const origin = await resolve(project, await project.checker.getPropertyOfType(type, nameText(node, source)));
      return hits(origin) ? localAt(project, binding.name, 'alias', true) : undefined;
    }
    if (parent.kind === K.ShorthandPropertyAssignment && parent.parent.kind === K.ObjectLiteralExpression) {
      const value = await resolve(project, await project.checker.getShorthandAssignmentValueSymbol(parent));
      if (!hits(value)) return undefined;
      const own = await project.checker.getSymbolOfDeclaration(parent as Declaration);
      return (await fresh(project, parent.parent, own)) ? { local: own, role: 'alias', marks: true, named: node } : undefined;
    }
    if (!hits(entry.symbol)) return undefined;
    if (
      (parent.kind === K.ImportSpecifier || parent.kind === K.ExportSpecifier) &&
      (parent as Node & { propertyName?: Node }).propertyName === node
    )
      return localAt(project, (parent as Node & { name: Node }).name, 'alias', true);
    const value = accessOf(node);
    const holder = value.parent;
    if (value.kind === K.LiteralType && holder?.kind === K.IndexedAccessType) {
      const declared = holder.parent as Node & { type?: Node; name?: Node };
      return declared?.kind === K.VariableDeclaration && declared.type === holder
        ? localAt(project, declared.name, 'implementation', false)
        : undefined;
    }
    if (holder?.kind === K.VariableDeclaration && (holder as Node & { initializer?: Node }).initializer === value)
      return localAt(project, (holder as Node & { name: Node }).name, 'alias', false);
    if (holder?.kind === K.BinaryExpression) {
      const assigned = holder as Node & { left: Node; right: Node; operatorToken: Node };
      if (assigned.right === value && assigned.operatorToken.kind === K.EqualsToken) return localAt(project, assigned.left, 'alias', false);
    }
    if (
      holder?.kind === K.PropertyAssignment &&
      (holder as Node & { initializer: Node }).initializer === value &&
      holder.parent.kind === K.ObjectLiteralExpression
    ) {
      const property = getNameOfDeclaration(holder as Declaration);
      if (property === undefined || !isIdentifier(property)) return undefined;
      const own = await project.checker.getSymbolOfDeclaration(holder as Declaration);
      return (await fresh(project, holder.parent, own)) ? { local: own, role: 'alias', marks: true, named: property } : undefined;
    }
    return undefined;
  };

  const projection = async (file: Loaded, symbol: TsSymbol, judged: Judged, hits: (symbol: TsSymbol | undefined) => boolean) => {
    const handle = symbol.declarations[0];
    if (handle === undefined || handle.kind !== K.VariableDeclaration) return false;
    const declared = (await handle.resolve(file.project)) as
      | (Node & { type?: Node & { objectType?: Node; indexType?: Node & { literal?: Node & { text?: string } } } })
      | undefined;
    const type = declared?.type;
    const name = judged.identity.name;
    if (type?.kind !== K.IndexedAccessType || type.objectType === undefined || type.indexType?.literal?.text !== name) return false;
    const object = await file.project.checker.getTypeAtLocation(type.objectType);
    if (vague(object)) return false;
    const member = await resolve(file.project, await file.project.checker.getPropertyOfType(object, name));
    rely(judged.basis, member);
    return hits(member);
  };

  const literalVerdict = async (
    file: Loaded,
    entry: Entry,
    judged: Judged,
    hits: (symbol: TsSymbol | undefined) => boolean,
    where: string | null,
  ) => {
    const { project, source } = file;
    const member = entry.node.parent;
    const property = await contextual(project, member.parent, nameText(entry.node, source));
    rely(judged.basis, property ?? undefined);
    if (property !== null && hits(property)) return use('implementation', where);
    const own = new Set(keysOf(entry.symbol));
    if (property !== null && property !== undefined && !keysOf(property).every((key) => own.has(key)))
      return { _tag: 'other', symbol: await label(project, property) } satisfies Verdict;
    if (property === undefined) return { _tag: 'other', symbol: LITERAL } satisfies Verdict;
    const required = await ownerNames(judged.identity);
    if (required === undefined) return unverified('unclear');
    const literal = member.parent as Node & { properties: readonly Node[] };
    if (literal.properties.some((one) => one.kind === K.SpreadAssignment)) return unverified('unclear');
    const present = new Set(
      literal.properties.flatMap((one) => {
        const named = getNameOfDeclaration(one as Declaration);
        return named === undefined ? [] : [nameText(named, source)];
      }),
    );
    return [...required].every((one) => present.has(one)) ? unverified('unclear') : ({ _tag: 'other', symbol: LITERAL } satisfies Verdict);
  };

  const verdictOf = async (file: Loaded, entry: Entry, judged: Judged): Promise<Verdict> => {
    const { project, source } = file;
    const node = entry.node;
    const hits = (symbol: TsSymbol | undefined) => keysOf(symbol).some((key) => judged.keys.has(key));
    const where = within(node, source);
    if (judged.severed.has(entry.at) || keysOf(entry.symbol).some((key) => judged.cut.has(key))) return unverified('alias-cut');
    if (judged.aliased.has(entry.at)) return use('alias', where);
    if (hits(entry.symbol)) {
      const offset = node.getStart(source);
      const found = judged.discovered.get(`${catalog.relative(source.fileName)}:${offset}`);
      if (found !== undefined) return use(found, where);
      if (
        declarationOf(node) !== undefined &&
        judged.identity.spots.some((spot) => spot.offset === offset && catalog.same(spot.abs, source.fileName))
      )
        return use(ROLES[judged.identity.role], where);
      return use(useOf(node), where);
    }
    if (isMemberName(node)) {
      if (node.parent.parent.kind === K.ObjectLiteralExpression) return literalVerdict(file, entry, judged, hits, where);
      if (node.parent.parent.kind === K.ClassDeclaration || node.parent.parent.kind === K.ClassExpression) {
        const bases = await implemented(project, node.parent, nameText(node, source));
        for (const base of bases) rely(judged.basis, base);
        if (bases.some(hits)) return use('implementation', where);
      }
    }
    const symbol = entry.symbol;
    if (symbol === undefined) {
      const value = accessOf(node);
      const receiver = value.kind === K.PropertyAccessExpression ? (value as Node & { expression: Node }).expression : undefined;
      if (receiver === undefined) return unverified(inImport(node) ? 'unclear' : 'untyped');
      return vague(await project.checker.getTypeAtLocation(receiver)) ? unverified('untyped') : unverified('unclear');
    }
    if (symbol.declarations.length > 0 && symbol.declarations.every((handle) => LOCALS.has(handle.kind))) {
      if (await projection(file, symbol, judged, hits)) return use('implementation', where);
      return { _tag: 'other', symbol: symbol.name };
    }
    return { _tag: 'other', symbol: await label(project, symbol) };
  };

  const judge = async (judging: Judging, signal: AbortSignal, pace = Number.POSITIVE_INFINITY): Promise<Judgement> => {
    const identity = decode(judging.subject);
    const keys = new Set(identity.keys);
    const near = [...new Set(identity.spots.map((spot) => spot.abs))];
    const verdicts: Verdict[] = new Array(judging.positions.length);
    const grouped = new Map<string, { at: number; position: Position }[]>();
    judging.positions.forEach((position, at) => {
      const list = grouped.get(position.path) ?? [];
      list.push({ at, position });
      grouped.set(position.path, list);
    });
    const absolute = new Map([...grouped.keys()].map((path) => [path, catalog.absolute(path)]));
    const assigned = view.assign([...absolute.values()], near);
    const files = (
      await paced([...grouped], pace, ([path, positions]) => {
        const abs = absolute.get(path) ?? path;
        return load(abs, assigned.get(abs), positions, identity.name, verdicts);
      })
    ).filter((file) => file !== undefined);
    const aliased = new Set<number>();
    const severed = new Set<number>();
    const settled = new Set<number>();
    const cut = new Set<string>();
    const discovered = new Map<string, UseKind>();
    const aliases = new Map<string, Subject>();
    const hits = (symbol: TsSymbol | undefined) => keysOf(symbol).some((key) => keys.has(key));
    const budget = Math.max(0, ALIAS_DEPTH - identity.depth);
    for (let depth = 0; depth <= budget; depth++) {
      signal.throwIfAborted();
      const found = (
        await paced(files, pace, (file) =>
          Promise.all(
            file.entries
              .filter((entry) => !aliased.has(entry.at) && !settled.has(entry.at))
              .map(async (entry) => {
                if (hits(entry.symbol)) settled.add(entry.at);
                return { file, entry, flow: await flows(file, entry, hits) };
              }),
          ),
        )
      ).flat();
      let grown = false;
      for (const { file, entry, flow } of found) {
        if (flow === undefined) continue;
        if (depth === budget) {
          if (flow.marks) severed.add(entry.at);
          for (const key of keysOf(flow.local)) if (!keys.has(key)) cut.add(key);
          continue;
        }
        if (flow.marks) aliased.add(entry.at);
        if (flow.local.name !== identity.name) {
          const extra = (flow.local.flags & SymbolFlags.Alias) !== 0 ? [...keys] : [];
          const line = placeOf(file.source, entry.node.getStart(file.source)).line;
          const subject = await subjectOf(
            file.project,
            flow.local,
            line,
            { name: flow.local.name, role: flow.role, depth: identity.depth + depth + 1, origin: null },
            extra,
          );
          aliases.set(subject.id, subject);
          continue;
        }
        discovered.set(`${catalog.relative(file.source.fileName)}:${flow.named.getStart(file.source)}`, flow.role);
        for (const key of keysOf(flow.local)) {
          if (keys.has(key)) continue;
          keys.add(key);
          grown = true;
        }
      }
      if (!grown && depth < budget) break;
    }
    signal.throwIfAborted();
    const basis = new Set(identity.spots.map((spot) => catalog.relative(spot.abs)));
    const judged: Judged = { identity, keys, cut, aliased, severed, discovered, basis };
    await paced(files, pace, (file) =>
      Promise.all(
        file.entries.map(async (entry) => {
          verdicts[entry.at] = await verdictOf(file, entry, judged);
        }),
      ),
    );
    if (identity.origin !== null && identity.origin !== identity.name) {
      const origin: Identity = { ...identity, name: identity.origin, origin: null, depth: identity.depth + 1 };
      aliases.set(encode(origin), { id: encode(origin), name: identity.origin, line: 1, declarations: await placesOf(identity.spots) });
    }
    for (const subject of aliases.values()) for (const place of subject.declarations) basis.add(place.path);
    return { verdicts, aliases: [...aliases.values()], basis: [...basis] };
  };

  const atLine = (
    source: SourceFile,
    line: number,
    name: string,
  ): readonly { readonly line: number; readonly nodes: readonly Name[] }[] => {
    const pattern = new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g');
    const total = placeOf(source, source.text.length).line;
    const namesIn = (text: string, start: number): Name[] => {
      const nodes: Name[] = [];
      for (const match of text.matchAll(pattern)) {
        const spotted = spotAt(source, start + match.index, name);
        if (spotted._tag === 'name') nodes.push(spotted.node);
      }
      return nodes;
    };
    for (const shift of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5]) {
      const at = line + shift;
      if (at < 1 || at > total) continue;
      const start = offsetOf(source, at, 1) ?? 0;
      const nodes = namesIn(placeOf(source, start).text, start);
      if (nodes.length > 0) return [{ line: at, nodes }];
    }
    const lines = new Map<number, Name[]>();
    for (const node of namesIn(source.text, 0)) {
      const at = placeOf(source, node.getStart(source)).line;
      lines.set(at, [...(lines.get(at) ?? []), node]);
    }
    return [...lines]
      .map(([at, nodes]) => ({ line: at, nodes }))
      .sort((left, right) => Math.abs(left.line - line) - Math.abs(right.line - line));
  };

  const implementedBy = async (project: Project, node: Node, symbol: TsSymbol | undefined, source: SourceFile) => {
    if (!isMemberName(node) || node.parent.parent.kind !== K.ObjectLiteralExpression) return symbol;
    const property = await contextual(project, node.parent.parent, nameText(node, source));
    return property ?? symbol;
  };

  const membersOf = async (project: Project, owner: TsSymbol, name: string): Promise<readonly TsSymbol[] | undefined> => {
    const types: Type[] = [await project.checker.getTypeOfSymbol(owner)];
    if ((owner.flags & (SymbolFlags.Class | SymbolFlags.Interface | SymbolFlags.TypeAlias)) !== 0)
      types.push(await project.checker.getDeclaredTypeOfSymbol(owner));
    if (types.every(vague)) return undefined;
    const found: TsSymbol[] = [];
    for (const type of types) {
      if (vague(type)) continue;
      const direct = await resolve(project, await project.checker.getPropertyOfType(type, name));
      if (direct !== undefined && direct.declarations.length > 0) found.push(direct);
      const service = await project.checker.getPropertyOfType(type, 'Service');
      if (service === undefined) continue;
      const shape = await project.checker.getTypeOfSymbol(service);
      if (vague(shape)) continue;
      const member = await resolve(project, await project.checker.getPropertyOfType(shape, name));
      if (member !== undefined && member.declarations.length > 0) found.push(member);
    }
    return found;
  };

  const locate = async (spot: Spot, signal: AbortSignal): Promise<Located> => {
    signal.throwIfAborted();
    const path = spot._tag === 'at' ? spot.path : spot.owner.path;
    const abs = catalog.absolute(path);
    const project = view.projectFor(abs, []);
    if (project === undefined) return { subjects: [], resolved: false };
    const source = await project.program.getSourceFile(abs);
    if (source === undefined) return { subjects: [], resolved: false };
    const found = atLine(source, spot._tag === 'at' ? spot.line : spot.owner.line, spot._tag === 'at' ? spot.name : spot.owner.name);
    const nodes = found.flatMap((one) => one.nodes);
    const lines = found.flatMap((one) => one.nodes.map(() => one.line));
    const symbols = await symbolsAt(project, nodes);
    const distinct = new Map<string, { readonly symbol: TsSymbol; readonly line: number }>();
    const keep = (symbol: TsSymbol, line: number) => {
      const key = keysOf(symbol).join('|');
      if (!distinct.has(key)) distinct.set(key, { symbol, line });
    };
    let resolved = false;
    if (spot._tag === 'at') {
      const named = await Promise.all(nodes.map((node, index) => implementedBy(project, node, symbols[index], source)));
      named.forEach((symbol, index) => {
        if (symbol !== undefined && symbol.declarations.length > 0) keep(symbol, lines[index] as number);
      });
      resolved = distinct.size > 0;
    } else {
      for (const [index, owner] of symbols.entries()) {
        const members = owner === undefined ? undefined : await membersOf(project, owner, spot.member);
        if (members === undefined) continue;
        resolved = true;
        for (const member of members) keep(member, lines[index] as number);
      }
    }
    const name = spot._tag === 'at' ? spot.name : spot.member;
    const subjects = await Promise.all(
      [...distinct.values()].map(({ symbol, line }) =>
        subjectOf(project, symbol, line, { name, role: 'subject', depth: 0, origin: symbol.name === name ? null : symbol.name }, []),
      ),
    );
    return { subjects, resolved };
  };

  const wants = (asked: Asked): readonly string[] => {
    if (asked._tag === 'judge') {
      const near = [...new Set(decode(asked.judging.subject).spots.map((spot) => spot.abs))];
      return view.wants([...new Set(asked.judging.positions.map((position) => catalog.absolute(position.path)))], near);
    }
    const config = catalog.configFor(catalog.absolute(asked.spot._tag === 'at' ? asked.spot.path : asked.spot.owner.path), []);
    return config === undefined ? [] : [config];
  };

  return { judge, locate, wants };
};

export type Semantics = ReturnType<typeof makeSemantics>;
