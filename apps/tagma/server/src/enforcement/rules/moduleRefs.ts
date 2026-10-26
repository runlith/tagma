import { Effect, Result } from 'effect';
import { BlockNames } from '../../graph/contract/service/acts.js';
import { isBlockName } from '../../graph/contract/wire/references.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ModuleRef } from '../contract/wire/modules.js';
import type { ModuleFaults } from './moduleFaults.js';

export type RefWorld = {
  readonly ids: ReadonlyMap<string, number>;
  readonly names: ReadonlyMap<number, string>;
  readonly removed: ReadonlyMap<number, string>;
  readonly fates: ReadonlyMap<string, { readonly said: string; readonly fix: string }>;
};

type Hit =
  | { readonly kind: 'card'; readonly block: number }
  | { readonly kind: 'removed'; readonly id: string }
  | { readonly kind: 'elsewhere' }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly said: string; readonly fix: string };

export const refResolver = Effect.fn('enforcement.refResolver')(function* (world: RefWorld, faults: ModuleFaults) {
  const names = yield* BlockNames;
  const memo = new Map<string, Hit>();

  const cardNamed = Effect.fn('enforcement.cardNamed')(function* (name: string): Effect.fn.Return<Hit, StoreFailure> {
    const held = memo.get(name);
    if (held !== undefined) return held;
    const found = yield* Effect.result(names.candidatesOfName(name));
    let hit: Hit;
    if (Result.isFailure(found)) {
      if (!(found.failure instanceof GateRefusal)) return yield* Effect.fail(found.failure);
      hit = { kind: 'none' };
    } else {
      const cards = found.success.filter((row) => world.names.has(row.id) || world.removed.has(row.id));
      const [only] = cards;
      if (only === undefined) hit = found.success.length > 0 ? { kind: 'elsewhere' } : { kind: 'none' };
      else if (cards.length > 1)
        hit = {
          kind: 'ambiguous',
          said: `${name} names ${cards.length} module cards`,
          fix: `write more of the name: ${cards.map((row) => row.uuid.replaceAll('-', '').slice(-12)).join(', ')}`,
        };
      else {
        const removed = world.removed.get(only.id);
        hit = removed !== undefined ? { kind: 'removed', id: removed } : { kind: 'card', block: only.id };
      }
    }
    memo.set(name, hit);
    return hit;
  });

  return Effect.fn('enforcement.resolveRef')(function* (module: string, field: string, ref: ModuleRef) {
    const fault = (said: string, fix: string): undefined => {
      faults.add(module, field, ref, said, fix);
      return undefined;
    };
    const absent = (id: string): undefined => {
      const fate = world.fates.get(id);
      return fate === undefined
        ? fault(`no module carries the id \`${id}\``, 'write the id of a standing module, or give the module birth in this call')
        : fault(`\`${id}\` is ${fate.said}`, fate.fix);
    };
    const aside = (hit: Hit, name: string): undefined => {
      if (hit.kind === 'removed')
        return fault(`${name} is the card of \`${hit.id}\`, removed in this call`, 'leave the reference out: its relations go with it');
      if (hit.kind === 'ambiguous') return fault(hit.said, hit.fix);
      if (hit.kind === 'elsewhere')
        return fault(
          `${name} is a block that is no module card of this project`,
          'name a module card: read_block of the module shows its name',
        );
      return fault(`no block is named ${name}`, 'write the module id, or the name of its card');
    };

    if (typeof ref !== 'string' && 'id' in ref) return world.ids.get(ref.id) ?? absent(ref.id);
    if (typeof ref !== 'string') {
      const hit = yield* cardNamed(ref.block);
      return hit.kind === 'card' ? hit.block : aside(hit, ref.block);
    }

    const byId = world.ids.get(ref);
    const hit: Hit | undefined = isBlockName(ref) ? yield* cardNamed(ref) : undefined;
    const byName = hit?.kind === 'card' ? hit.block : undefined;
    if (byId !== undefined && byName !== undefined && byId !== byName) {
      const shown = (block: number) => (block > 0 ? `{ block: "${world.names.get(block)}" }` : `{ id: "${ref}" }`);
      return fault(`\`${ref}\` is the id of one module and the name of another`, `write ${shown(byId)} or ${shown(byName)}`);
    }
    if (byId !== undefined && hit?.kind === 'ambiguous')
      return fault(`\`${ref}\` is a module id and also an ambiguous block name`, `write { id: "${ref}" } or more of the block name`);
    if (byId !== undefined || byName !== undefined) return byId ?? byName;
    if (hit === undefined || hit.kind === 'none') return absent(ref);
    return aside(hit, ref);
  });
});
