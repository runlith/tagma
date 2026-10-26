import { statSync } from 'node:fs';
import { join } from 'node:path';
import { takesMap } from '@tagma/inspection/builtins';
import { Effect } from 'effect';
import { Blocks } from '../../graph/contract/service/blocks.js';
import { Act, BlockNames, type BlockRow } from '../../graph/contract/service/acts.js';
import { measuredRoot } from '../../graph/contract/service/serving.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import {
  type CardRef,
  type ModuleCard,
  type ModuleEntries,
  type ModuleOrder,
  type ModuleWrite,
  ROOT_FLOOR,
} from '../../graph/contract/wire/modules.js';
import { blockName } from '../../graph/contract/wire/references.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Projects } from '../../projects/contract/service/registry.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import type { CheckSubjectKind } from '../../platform/contract/wire/operation.js';
import { type Check, type Descriptions, isProgrammed, isUnrun, type MapReading } from '../contract/wire/document.js';
import { descriptionsAt } from './descriptions.js';
import { placeOf } from './measure.js';
import type { EntryAsk, ModuleChange, ModuleRef, ModuleSet, ModulesPlan } from '../contract/wire/modules.js';
import { assembleMap, dirOf } from './moduleMap.js';
import { type ChangeFault, type ChangePart, changedSet } from './moduleChange.js';
import { ModuleFaults } from './moduleFaults.js';
import { refResolver, type RefWorld } from './moduleRefs.js';
import { type Enforced, enforcedRules } from './reach.js';
import { enforcementWriteOf, measurementKept, type Prepared, planEnforcement, staleUnder } from './enforce.js';

type Draft = { -readonly [K in keyof ModuleCard]: ModuleCard[K] };

type Door = ModuleEntries[number];

type Resolved<Item, Key> = ModuleChange<Item | undefined, Key | undefined>;

export type ModuleAsk = ModuleSet & { readonly card?: BlockRow | GateRefusal; readonly under?: BlockRow | GateRefusal };

export type ModulesInput = {
  readonly projectId: number;
  readonly modules: readonly ModuleAsk[];
  readonly owners?: Readonly<Record<string, string>>;
  readonly owner?: string;
  readonly absorb?: 'all' | readonly string[];
  readonly caller: TerminalActor | null;
  readonly subjectOf: (op: string) => CheckSubjectKind | null;
};

export type ModulesPrepared = ModulesPlan & {
  readonly projectId: number;
  readonly stood: string;
  readonly writes: readonly ModuleWrite[];
  readonly measured: readonly Prepared[];
  readonly descriptions: Descriptions;
};

type Slot =
  | { readonly kind: 'remove'; readonly ask: ModuleAsk; readonly block: number; readonly gone: Draft }
  | {
      readonly kind: 'set';
      readonly ask: ModuleAsk;
      readonly known: number | undefined;
      readonly under: BlockRow | undefined;
      readonly card: Draft;
    }
  | { readonly kind: 'unsound'; readonly ask: ModuleAsk };

type Disk = 'dir' | 'file' | { readonly unreadable: string } | null;

const applying = writes('enforcement.applyModules', []);

const shape = (reason: string) =>
  new GateRefusal('module-shape', reason, ['set_module again with the cards the reason names corrected in the same call']);

const diskAt = (root: string, path: string): Disk => {
  try {
    const found = statSync(join(root, path), { throwIfNoEntry: false });
    return found === undefined ? null : found.isDirectory() ? 'dir' : 'file';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOTDIR') return null;
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
};

const listOf = (change: ModuleChange<unknown, unknown>, part: ChangePart): readonly unknown[] | undefined => {
  if ('replace' in change) return part === 'replace' ? change.replace : undefined;
  return part === 'put' ? change.put : part === 'drop' ? change.drop : undefined;
};

const takesTheMap = (check: Check): boolean => !isUnrun(check) && !isProgrammed(check) && takesMap(check);

const mapRules = Effect.fn('enforcement.mapRules')(function* (projectId: number, descriptions: Descriptions, read: MapReading) {
  return (yield* enforcedRules(projectId, descriptions, read)).filter(
    (entry) => entry.document !== null && takesTheMap(entry.document.check),
  );
});

const standingOf = Effect.fn('enforcement.standingOf')(function* (cards: readonly ModuleCard[], rules: readonly Enforced[]) {
  const reach = yield* Effect.forEach(rules, (entry) => Effect.map(entry.reach(''), (places) => [entry.rule.id, places] as const));
  return JSON.stringify([cards, reach.sort((a, b) => a[0] - b[0])]);
});

export const planModules = Effect.fn('enforcement.planModules')(function* (input: ModulesInput) {
  const blocks = yield* Blocks;
  const project = yield* (yield* Projects).byId(input.projectId);
  const root = yield* measuredRoot(project);
  const standing = yield* blocks.moduleCards(input.projectId);
  const before = assembleMap(standing);
  const pinned = { root, ...(yield* placeOf(root)) };
  const descriptions = yield* descriptionsAt({
    projectId: input.projectId,
    actor: input.caller ?? { _tag: 'Operator' },
    root,
    tree: pinned.head,
    commonDir: pinned.commonDir,
  });
  const taking = yield* mapRules(input.projectId, descriptions, before);
  const stood = yield* standingOf(standing, taking);
  const cards = new Map<number, Draft>(standing.map((card) => [card.block, { ...card }] as const));
  const standingIds = new Map<string, number>();
  for (const card of standing) if (card.id !== undefined && !standingIds.has(card.id)) standingIds.set(card.id, card.block);
  const faults = new ModuleFaults();

  const moduleAbove = Effect.fn('enforcement.moduleAbove')(function* (under: BlockRow) {
    for (
      let at: BlockRow | undefined = under;
      at !== undefined;
      at = at.parentId === null ? undefined : yield* blocks.blockById(at.parentId)
    ) {
      if (cards.has(at.id)) return at.id;
    }
    return null;
  });
  const ancestry = Effect.fn('enforcement.ancestry')(function* (from: BlockRow) {
    const chain: number[] = [];
    for (
      let at: BlockRow | undefined = from;
      at !== undefined && !chain.includes(at.id);
      at = at.parentId === null ? undefined : yield* blocks.blockById(at.parentId)
    )
      chain.push(at.id);
    return chain;
  });

  let born = 0;
  const slots: Slot[] = [];
  const addressed = new Set<number>();
  const asked = new Set<string>();
  const removed = new Map<number, string>();
  const removedNames = new Map<string, string>();
  const fates = new Map<string, { readonly said: string; readonly fix: string }>();
  const renamedIds = new Map<string, string>();

  for (const raw of input.modules) {
    const ask: ModuleAsk = raw.root === undefined ? raw : { ...raw, root: raw.root.replace(/\/+$/, '') };
    const fail = (field: string, value: unknown, said: string, fix: string) => faults.add(ask.id, field, value, said, fix);
    if (asked.has(ask.id)) {
      fail('id', ask.id, 'is written twice in one call', 'merge the two entries into one');
      slots.push({ kind: 'unsound', ask });
      continue;
    }
    asked.add(ask.id);

    const row = ask.card instanceof GateRefusal ? undefined : ask.card;
    const rowFault =
      ask.card instanceof GateRefusal
        ? ask.card.reason
        : row === undefined
          ? undefined
          : row.projectId !== input.projectId
            ? `${blockName(row.uuid)} belongs to another project`
            : cards.has(row.id)
              ? undefined
              : `${blockName(row.uuid)} is no #module card`;
    if (rowFault !== undefined) fail('block', ask.block, rowFault, 'name the card of a module of this project');
    const sideFault =
      ask.under instanceof GateRefusal
        ? ask.under.reason
        : ask.under !== undefined && ask.under.projectId !== input.projectId
          ? `${blockName(ask.under.uuid)} belongs to another project`
          : undefined;
    if (sideFault !== undefined) fail('parent', ask.parent, sideFault, 'name a block of this project');
    if (rowFault !== undefined) {
      slots.push({ kind: 'unsound', ask });
      continue;
    }
    const known = row === undefined ? standingIds.get(ask.id) : row.id;
    if (known !== undefined && addressed.has(known)) {
      fail('id', ask.id, 'names a card this call already writes', 'merge the entries that write the same card');
      slots.push({ kind: 'unsound', ask });
      continue;
    }
    if (known !== undefined) addressed.add(known);

    if (ask.remove === true) {
      if (known === undefined) {
        fail('remove', true, 'names no module to remove', 'write the id of a standing module');
        slots.push({ kind: 'unsound', ask });
        continue;
      }
      const held = (yield* blocks.childrenOf(known)).length;
      if (held > 0) {
        fail('remove', true, `holds ${held} block(s)`, 'move or delete them before the module');
        slots.push({ kind: 'unsound', ask });
        continue;
      }
      const gone = cards.get(known)!;
      cards.delete(known);
      for (const card of cards.values()) {
        card.imports = card.imports.filter((one) => one !== known);
        card.importsTests = card.importsTests.filter((one) => one !== known);
      }
      removed.set(known, gone.id ?? ask.id);
      removedNames.set(gone.name, gone.id ?? ask.id);
      if (gone.id !== undefined)
        fates.set(gone.id, { said: 'removed in this call', fix: 'leave the reference out: its relations go with it' });
      slots.push({ kind: 'remove', ask, block: known, gone });
      continue;
    }

    if (known === undefined && (ask.title === undefined || ask.root === undefined))
      fail(
        'id',
        ask.id,
        'is no standing module, and a new module is born with its title and its root',
        'send `title` and `root`, or the id of a standing module',
      );
    const under =
      ask.under instanceof GateRefusal || sideFault !== undefined
        ? undefined
        : (ask.under ?? (known === undefined ? yield* blocks.rootBlockOf(input.projectId) : undefined));
    if (known !== undefined && under !== undefined && (yield* ancestry(under)).includes(known))
      fail('parent', ask.parent, `${blockName(under.uuid)} stands under this module`, 'name a parent outside the module');
    const parent = under === undefined ? undefined : yield* moduleAbove(under);
    let card: Draft;
    if (known === undefined) {
      born -= 1;
      card = {
        block: born,
        name: `new:${ask.id}`,
        title: ask.title ?? ask.id,
        parent: parent ?? null,
        placedUnder: under?.id ?? null,
        id: ask.id,
        roots: [],
        cuts: [],
        entries: undefined,
        order: undefined,
        imports: [],
        importsTests: [],
        unreadable: undefined,
      };
      cards.set(born, card);
    } else {
      card = cards.get(known)!;
      if (card.id !== undefined && card.id !== ask.id) {
        fates.set(card.id, { said: `renamed to \`${ask.id}\` in this call`, fix: `write \`${ask.id}\`` });
        renamedIds.set(card.id, ask.id);
      }
      Object.assign(card, { id: ask.id, parent: parent ?? card.parent });
    }
    slots.push({ kind: 'set', ask, known, under, card });
  }

  const ids = new Map<string, number>();
  const doubled = new Set<string>();
  for (const card of cards.values()) {
    if (card.id === undefined) continue;
    if (ids.has(card.id) && !doubled.has(card.id)) {
      doubled.add(card.id);
      faults.add(card.id, 'id', card.id, 'is carried by two module cards', 'give one of them another id with `block`');
    }
    if (!ids.has(card.id)) ids.set(card.id, card.block);
  }
  const world: RefWorld = { ids, names: new Map([...cards.values()].map((card) => [card.block, card.name] as const)), removed, fates };
  const resolve = yield* refResolver(world, faults);

  const faultAt =
    (module: string, field: string, change: ModuleChange<unknown, unknown>): ChangeFault =>
    (part, index, said, fix) =>
      faults.add(module, `${field}.${part}[${index}]`, listOf(change, part)?.[index], said, fix);

  const relationRefs = Effect.fn('enforcement.relationRefs')(function* (
    module: string,
    field: string,
    change: ModuleChange<ModuleRef, ModuleRef>,
  ): Effect.fn.Return<Resolved<CardRef, CardRef>, StoreFailure> {
    const resolved = (part: ChangePart, refs: readonly ModuleRef[]) =>
      Effect.forEach(refs, (ref, index) => resolve(module, `${field}.${part}[${index}]`, ref));
    if ('replace' in change) return { replace: yield* resolved('replace', change.replace) };
    return { put: yield* resolved('put', change.put ?? []), drop: yield* resolved('drop', change.drop ?? []) };
  });

  const doorRefs = Effect.fn('enforcement.doorRefs')(function* (
    module: string,
    change: NonNullable<ModuleSet['entries']>,
  ): Effect.fn.Return<Resolved<Door, string>, StoreFailure> {
    const resolved = (part: ChangePart, entries: readonly EntryAsk[]) =>
      Effect.forEach(entries, (entry, index) =>
        Effect.gen(function* () {
          const open = yield* Effect.forEach(entry.for ?? [], (ref, at) => resolve(module, `entries.${part}[${index}].for[${at}]`, ref));
          const names = new Set<string>();
          for (const block of open) {
            const name = block === undefined ? undefined : world.names.get(block);
            if (name !== undefined) names.add(name);
          }
          const [first, ...rest] = names;
          return {
            at: entry.at,
            for: first === undefined ? undefined : ([first, ...rest] as const),
            role: entry.role,
          } satisfies Door;
        }),
      );
    if ('replace' in change) return { replace: yield* resolved('replace', change.replace) };
    return { put: yield* resolved('put', change.put ?? []), drop: change.drop };
  });

  const found = (module: string, field: string, value: unknown, path: string, want: 'dir' | 'file' | 'any'): boolean => {
    const disk = diskAt(root, path);
    if (disk !== null && typeof disk === 'object') {
      faults.add(
        module,
        field,
        value,
        `the working tree cannot be read at \`${path}\`: ${disk.unreadable}`,
        'make it readable, then send the call again',
      );
      return false;
    }
    if (disk !== null && (want === 'any' || want === disk)) return true;
    faults.add(
      module,
      field,
      value,
      want === 'any'
        ? `\`${path}\` is not in the working tree`
        : `\`${path}\` is no ${want === 'dir' ? 'directory' : 'file'} of the working tree`,
      want === 'any' ? 'send a path the tree holds; a `drop` never needs the path' : 'send a path the tree holds',
    );
    return false;
  };

  for (const slot of slots) {
    if (slot.kind === 'remove') continue;
    const { ask } = slot;
    const imports = ask.imports === undefined ? undefined : yield* relationRefs(ask.id, 'imports', ask.imports);
    const importsTests = ask.importsTests === undefined ? undefined : yield* relationRefs(ask.id, 'importsTests', ask.importsTests);
    const doors = ask.entries === undefined ? undefined : yield* doorRefs(ask.id, ask.entries);
    if (slot.kind === 'unsound') continue;
    const { card } = slot;

    const rootGood = ask.root === undefined ? card.roots[0] !== undefined : found(ask.id, 'root', ask.root, ask.root, 'dir');
    const rootAt = ask.root ?? card.roots[0];
    const rootMoved = ask.root !== undefined && (card.roots[0] === undefined || dirOf(card.roots[0]) !== dirOf(ask.root));
    const checked = new Set<string>();
    const inside = (kind: 'entries' | 'order', field: string, at: string) => {
      if (!rootGood || rootAt === undefined || at === ROOT_FLOOR || checked.has(`${kind}\0${at}`)) return;
      checked.add(`${kind}\0${at}`);
      found(ask.id, field, at, `${dirOf(rootAt)}${at}`, 'any');
    };

    if (ask.cuts !== undefined) {
      const cuts = changedSet(
        card.cuts,
        ask.cuts,
        (path) => path,
        (path) => `\`${path}\``,
        faultAt(ask.id, 'cuts', ask.cuts),
      );
      const standingCuts = new Set(card.cuts);
      for (const path of cuts) if (!standingCuts.has(path)) found(ask.id, 'cuts', path, path, 'file');
      card.cuts = cuts;
    }

    const unread = card.unreadable?.entries;
    if (unread !== undefined && ask.entries !== undefined && !('replace' in ask.entries))
      faults.add(
        ask.id,
        'entries',
        undefined,
        `the stored entries do not read (${unread}), so a delta has no set to change`,
        'send `entries: { replace: [...] }` with the whole set, which corrects them',
      );
    if (ask.entries !== undefined && doors !== undefined) {
      const entries = changedSet(
        card.entries ?? [],
        doors,
        (door) => door.at,
        (at) => `the entry \`${at}\``,
        faultAt(ask.id, 'entries', ask.entries),
      );
      const sent = new Set<string>();
      const [part, sentList] =
        'replace' in ask.entries ? (['replace', ask.entries.replace] as const) : (['put', ask.entries.put ?? []] as const);
      sentList.forEach((entry, index) => {
        sent.add(entry.at);
        inside('entries', `entries.${part}[${index}]`, entry.at);
      });
      if (rootMoved) for (const door of entries) if (!sent.has(door.at)) inside('entries', 'entries', door.at);
      card.entries = entries.length === 0 ? undefined : entries;
    } else if (rootMoved) {
      for (const door of card.entries ?? []) inside('entries', 'entries', door.at);
    }

    const order: ModuleOrder | undefined = ask.order === null ? undefined : (ask.order ?? (rootMoved ? card.order : undefined));
    if (order !== undefined) order.forEach((floor, index) => floor.forEach((at) => inside('order', `order[${index}]`, at)));
    if (ask.order !== undefined) card.order = ask.order ?? undefined;

    if (ask.root !== undefined) card.roots = [ask.root];
    if (imports !== undefined && ask.imports !== undefined)
      card.imports = changedSet(
        card.imports,
        imports,
        (block) => block,
        (block) => `\`${cards.get(block)?.id ?? block}\``,
        faultAt(ask.id, 'imports', ask.imports),
      );
    if (importsTests !== undefined && ask.importsTests !== undefined)
      card.importsTests = changedSet(
        card.importsTests,
        importsTests,
        (block) => block,
        (block) => `\`${cards.get(block)?.id ?? block}\``,
        faultAt(ask.id, 'importsTests', ask.importsTests),
      );
    const left = {
      ...(card.unreadable?.entries !== undefined && !(ask.entries !== undefined && 'replace' in ask.entries)
        ? { entries: card.unreadable.entries }
        : {}),
      ...(card.unreadable?.order !== undefined && ask.order === undefined ? { order: card.unreadable.order } : {}),
    };
    card.unreadable = Object.keys(left).length === 0 ? undefined : left;
  }

  for (const card of cards.values()) {
    for (const door of card.entries ?? []) {
      for (const name of door.for ?? []) {
        const gone = removedNames.get(name);
        if (gone !== undefined)
          faults.add(
            card.id ?? card.name,
            `entries[${door.at}].for`,
            name,
            `is open to \`${gone}\`, a module removed in this call`,
            'send the entry in `put` with a `for` that leaves it out (an empty `for` would open it to every importer), or drop the entry',
          );
      }
    }
  }
  if (faults.any) return yield* faults.refusal();

  const after = assembleMap([...cards.values()]);
  if (after.problems.length > 0) return yield* shape(`the module map would not hold together: ${after.problems.join('; ')}`);

  const blockOfName = new Map([...cards.values()].map((card) => [card.name, card.block] as const));
  const cardNamed = (name: string): CardRef => {
    const block = blockOfName.get(name);
    if (block === undefined) throw new RangeError(`the map holds ${name} in an entry, and no module card carries that name`);
    return block;
  };
  const doorWrite = (door: Door) => ({
    at: door.at,
    for: door.for?.map(cardNamed),
    role: door.role,
  });

  const plan: ModuleWrite[] = [];
  const modules: ModulesPlan['modules'][number][] = [];
  for (const slot of slots) {
    if (slot.kind === 'unsound') continue;
    const { ask } = slot;
    if (slot.kind === 'remove') {
      plan.push({ id: ask.id, block: slot.block, remove: true });
      modules.push({ id: ask.id, card: slot.gone.name, act: 'remove' });
      continue;
    }
    const { card, known, under } = slot;
    plan.push({
      id: ask.id,
      ...(known === undefined
        ? {
            handle: card.block,
            title: ask.title,
            body: ask.body,
          }
        : { block: known }),
      parent: under?.id,
      root: ask.root,
      cuts: ask.cuts === undefined ? undefined : card.cuts,
      entries: ask.entries === undefined ? undefined : card.entries === undefined ? null : card.entries.map(doorWrite),
      order: ask.order,
      imports: ask.imports === undefined ? undefined : card.imports,
      importsTests: ask.importsTests === undefined ? undefined : card.importsTests,
    });
    modules.push({ id: ask.id, card: known === undefined ? null : card.name, act: known === undefined ? 'create' : 'update' });
  }

  const measured: Prepared[] = [];
  if (JSON.stringify(before.map) !== JSON.stringify(after.map)) {
    for (const entry of taking) {
      if (entry.document === null) continue;
      const row = yield* blocks.blockById(entry.rule.id);
      measured.push(
        yield* planEnforcement(row, {
          strictness: entry.document.strictness,
          on: entry.document.on,
          base: null,
          remap: after,
          previousMap: before,
          renamedModules: renamedIds,
          pinned,
          caller: input.caller,
          subjectOf: input.subjectOf,
          owners: input.owners,
          owner: input.owner,
          absorb: input.absorb,
        }),
      );
    }
  }
  return {
    projectId: input.projectId,
    stood,
    writes: plan,
    measured,
    descriptions,
    modules,
    rules: measured.map((one) => ({
      rule: one.rule,
      title: one.title,
      head: one.head ?? '',
      ms: one.ms ?? 0,
      debt: { before: one.debt.before.length, after: one.debt.after.length },
      absorbed: one.absorbed,
      retired: one.retired,
      escaped: one.escaped,
    })),
  } satisfies ModulesPrepared;
});

export const applyModules = Effect.fn('enforcement.applyModules')(function* (prepared: ModulesPrepared) {
  const trees: (string | undefined)[] = [];
  for (const one of prepared.measured) trees.push(yield* staleUnder(one, 'set_module'));
  const blocks = yield* Blocks;
  const landed = yield* (yield* Act).unit(
    applying,
    Effect.gen(function* () {
      const cards = yield* blocks.moduleCards(prepared.projectId);
      const now = yield* standingOf(cards, yield* mapRules(prepared.projectId, prepared.descriptions, assembleMap(cards)));
      if (now !== prepared.stood) {
        return yield* new GateRefusal(
          'enforcement-stale',
          'the module cards, or the reach of the enforced rules that run over the map, moved after this change was measured',
          ['set_module again: prepare measures the cards and the rules that stand'],
        );
      }
      return yield* blocks.writeModules(prepared.projectId, prepared.writes, prepared.measured.map(enforcementWriteOf));
    }),
  );
  yield* Effect.forEach(prepared.measured, (one, at) => measurementKept(one, trees[at]), { discard: true });
  const names = yield* BlockNames;
  const modules = yield* Effect.forEach(prepared.modules, (one, at) =>
    one.card !== null || landed[at] === undefined
      ? Effect.succeed(one)
      : Effect.map(names.nameOf(landed[at]), (card) => ({ ...one, card })),
  );
  return { ...prepared, modules };
});
