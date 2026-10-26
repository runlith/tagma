import type { MapModule, ModuleMap } from '@tagma/inspection/rule';
import { type ModuleCard, ROOT_FLOOR } from '../../graph/contract/wire/modules.js';
import type { MapReading } from '../contract/wire/document.js';

export const dirOf = (path: string): string => `${path.replace(/\/+$/, '')}/`;

const under = (root: string, at: string): string => (at === ROOT_FLOOR ? dirOf(root) : `${dirOf(root)}${at}`);

const RELATIONS = [
  ['imports', undefined],
  ['importsTests', 'testing'],
] as const;

export const assembleMap = (cards: readonly ModuleCard[]): MapReading => {
  const problems: string[] = [];
  const byBlock = new Map(cards.map((card) => [card.block, card] as const));
  const byName = new Map(cards.map((card) => [card.name, card] as const));
  const parents = new Set(cards.flatMap((card) => (card.parent === null ? [] : [card.parent])));
  const region = new Set<string>();
  const modules: MapModule[] = [];
  const relations: ModuleMap['relations'][number][] = [];
  const idOf = (card: ModuleCard | undefined, from: ModuleCard, what: string): string | undefined => {
    if (card === undefined) problems.push(`${from.name} names under ${what} a block that is no module card`);
    else if (parents.has(card.block))
      problems.push(`${from.name} names under ${what} ${card.name}, a module that holds modules and has no code of its own`);
    else if (card.id === undefined) problems.push(`${from.name} names under ${what} ${card.name}, which has no module id`);
    else return card.id;
    return undefined;
  };
  for (const card of cards) {
    if (card.unreadable !== undefined)
      problems.push(
        `${card.name}: ${Object.entries(card.unreadable)
          .map(([field, said]) => `${field}: ${said}`)
          .join('; ')}`,
      );
    if (card.roots.length !== 1)
      problems.push(`${card.name} carries ${card.roots.length} directory sources, and a module has exactly one root`);
    for (const root of card.roots) region.add(dirOf(root));
    for (const cut of card.cuts) region.add(cut);
    if (parents.has(card.block)) {
      const held = [
        ...(card.imports.length + card.importsTests.length > 0 ? ['relations'] : []),
        ...(card.entries === undefined ? [] : ['entries']),
        ...(card.order === undefined ? [] : ['an order']),
        ...(card.cuts.length > 0 ? ['file sources'] : []),
      ];
      if (held.length > 0) problems.push(`${card.name} holds modules and has no code of its own, yet carries ${held.join(', ')}`);
      continue;
    }
    if (card.id === undefined) {
      problems.push(`${card.name} carries no module id`);
      continue;
    }
    const [root] = card.roots;
    if (root === undefined) continue;
    const entries = (card.entries ?? []).map((door) => {
      const only = door.for?.flatMap((name) => idOf(byName.get(name), card, `\`for\` of ${door.at}`) ?? []);
      return {
        at: under(root, door.at),
        for: only === undefined || only.length === 0 ? undefined : ([only[0]!, ...only.slice(1)] as const),
        role: door.role,
      };
    });
    const order = card.order?.map(([low, ...rest]) => [under(root, low), ...rest.map((at) => under(root, at))] as const);
    modules.push({
      id: card.id,
      territory: [dirOf(root), ...card.cuts],
      entries,
      order,
    });
    for (const [key, role] of RELATIONS) {
      for (const target of card[key]) {
        const to = idOf(byBlock.get(target), card, key === 'imports' ? 'imports' : 'imports-tests');
        if (to === undefined) continue;
        if (role === 'testing' && card.imports.includes(target)) {
          problems.push(`\`${card.id}\` both imports and imports-tests \`${to}\`; its imports carry its test code already`);
          continue;
        }
        relations.push({ from: card.id, to, role });
      }
    }
  }
  return { map: { modules, relations, region: [...region].sort() }, problems };
};
