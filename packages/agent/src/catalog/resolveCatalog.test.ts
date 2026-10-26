import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { CatalogNameCollision, type CatalogContribution, type ToolGrant, offeredSources, resolveCatalog } from './resolveCatalog';
import { makeToolSourceRegistry } from './toolSources';
const game: CatalogContribution<string> = { source: 'game', tools: { look: 'look', act: 'act', secret: 'secret' } };
const fork: CatalogContribution<string> = { source: 'fork', tools: { fork_thread: 'fork' } };
const question: CatalogContribution<string> = { source: 'user-question', tools: { ask_user: 'ask' } };
const messages: CatalogContribution<string> = { source: 'collaboration', tools: { send_message: 'send' } };
const player: ToolGrant = { sources: [{ source: 'game', tools: ['look', 'act'] }] };
describe('the catalog is what the definition grants', () => {
  test('a definition granting look and act from one source is offered exactly those, and every other tool is withheld with a reason', () => {
    const resolved = resolveCatalog({ grant: player }, {}, [game, fork, question, messages]);
    expect(Object.keys(resolved.catalog)).toEqual(['look', 'act']);
    expect([...resolved.withheld].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'ask_user', reason: 'not-granted' },
      { name: 'fork_thread', reason: 'not-granted' },
      { name: 'secret', reason: 'not-granted' },
      { name: 'send_message', reason: 'not-granted' },
    ]);
  });
  test('a source granted whole offers every tool it contributes', () => {
    const resolved = resolveCatalog({ grant: { sources: [{ source: 'game' }, { source: 'fork' }] } }, {}, [game, fork, question]);
    expect(Object.keys(resolved.catalog).sort()).toEqual(['act', 'fork_thread', 'look', 'secret']);
  });
  test('an explicit deny of the grant wins over the grant', () => {
    const resolved = resolveCatalog({ grant: { sources: [{ source: 'game' }], deny: ['secret'] } }, {}, [game]);
    expect(Object.keys(resolved.catalog)).toEqual(['look', 'act']);
    expect(resolved.withheld).toEqual([{ name: 'secret', reason: 'denied' }]);
  });
  test('an unconditional verdict of the mode or policy removes the tool and names the reason', () => {
    const resolved = resolveCatalog({ grant: { sources: [{ source: 'game' }] } }, {}, [game], (name) =>
      name === 'act' ? { rule: 'no-acting' } : null,
    );
    expect(Object.keys(resolved.catalog)).toEqual(['look', 'secret']);
    expect(resolved.withheld).toEqual([{ name: 'act', reason: 'denied-by-policy' }]);
  });
  test('a profile narrows inside the grant and can never add to it', () => {
    const grant: ToolGrant = { sources: [{ source: 'game' }, { source: 'fork', narrowable: true }] };
    expect(Object.keys(resolveCatalog({ grant }, { tools: ['look', 'fork_thread', 'ask_user'] }, [game, fork, question]).catalog)).toEqual([
      'look',
      'fork_thread',
    ]);
    const narrowed = resolveCatalog({ grant }, { sources: [] }, [game, fork]);
    expect(Object.keys(narrowed.catalog)).toEqual(['look', 'act', 'secret']);
    expect(narrowed.withheld).toEqual([{ name: 'fork_thread', reason: 'not-in-profile' }]);
    expect([...offeredSources({ grant }, { sources: [] })]).toEqual(['game']);
  });
  test('what the definition grants as standing stays when a profile names other tools, and nothing beyond it does', () => {
    const grant: ToolGrant = {
      sources: [
        { source: 'game' },
        { source: 'fork', standing: true },
        { source: 'collaboration', narrowable: true, standing: ['send_message'] },
      ],
    };
    const more: CatalogContribution<string> = { source: 'collaboration', tools: { send_message: 'send', spawn_agent: 'spawn' } };
    const resolved = resolveCatalog({ grant }, { tools: ['look'] }, [game, fork, question, more]);
    expect(Object.keys(resolved.catalog)).toEqual(['look', 'fork_thread', 'send_message']);
    expect(resolved.withheld).toContainEqual({ name: 'spawn_agent', reason: 'not-in-profile' });
  });
  test('a derived contribution answers from what was admitted, and meets the same grant', () => {
    const search: CatalogContribution<string> = {
      source: 'tool_search',
      derive: (admitted): Record<string, string> => (Object.keys(admitted).length === 0 ? {} : { tool_search: 'search' }),
    };
    expect(
      Object.keys(resolveCatalog({ grant: { sources: [{ source: 'game' }, { source: 'tool_search' }] } }, {}, [game, search]).catalog),
    ).toEqual(['look', 'act', 'secret', 'tool_search']);
    expect(resolveCatalog({ grant: player }, {}, [game, search]).withheld).toContainEqual({ name: 'tool_search', reason: 'not-granted' });
    expect(resolveCatalog({ grant: { sources: [{ source: 'tool_search' }] } }, {}, [game, search]).catalog).toEqual({});
  });
  test('two admitted sources offering one name refuse, naming both', () => {
    const rival: CatalogContribution<string> = { source: 'rival', tools: { look: 'other look' } };
    let collision: unknown;
    try {
      resolveCatalog({ grant: { sources: [{ source: 'game' }, { source: 'rival' }] } }, {}, [game, rival]);
    } catch (failure) {
      collision = failure;
    }
    expect(collision).toBeInstanceOf(CatalogNameCollision);
    expect(collision).toMatchObject({ tool: 'look', first: 'game', second: 'rival' });
  });
});
describe('the registry of tool sources', () => {
  const source = (id: string, owner: string) => ({ id, owner, names: [`${id}_verb`], offer: () => Effect.succeed(id) });
  const registryOf = () => makeToolSourceRegistry<void, string, never>({ declined: (id) => `${id} (declined)` });
  it.effect(
    'two contributors of one id refuse at registration with both owners named',
    Effect.fnUntraced(function* () {
      const registry = registryOf();
      yield* registry.register(source('notes', 'planes'));
      const refusal = yield* Effect.flip(registry.register(source('notes', 'plugin')));
      expect(refusal).toMatchObject({
        _tag: 'RegistryCollision',
        registry: 'tool source',
        id: 'notes',
        holder: 'planes',
        claimant: 'plugin',
      });
    }),
  );
  it.effect(
    'a disposed source is no longer offered, and its id is free again',
    Effect.fnUntraced(function* () {
      const registry = registryOf();
      const dispose = yield* registry.register(source('notes', 'planes'));
      yield* registry.register(source('fork', 'planes'));
      expect(yield* registry.offers(undefined, ['notes', 'fork'])).toEqual(['notes', 'fork']);
      dispose();
      expect(yield* registry.offers(undefined)).toEqual(['fork']);
      yield* registry.register(source('notes', 'plugin'));
      expect(yield* registry.offers(undefined)).toEqual(['fork', 'notes']);
    }),
  );
  it.effect(
    'a source outside the asked set is declined with its names, and the resolver withholds them',
    Effect.fnUntraced(function* () {
      const registry = registryOf();
      yield* registry.register(source('notes', 'planes'));
      yield* registry.register(source('fork', 'planes'));
      expect(yield* registry.offers(undefined, ['fork'])).toEqual(['notes (declined)', 'fork']);
      const resolved = resolveCatalog({ grant: player }, {}, [game, { source: 'notes', declined: ['notes_verb'] }]);
      expect(resolved.withheld).toContainEqual({ name: 'notes_verb', reason: 'not-granted' });
      expect(Object.keys(resolved.catalog)).toEqual(['look', 'act']);
    }),
  );
});
