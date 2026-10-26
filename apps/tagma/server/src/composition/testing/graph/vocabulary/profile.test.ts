import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Result } from 'effect';
import { NO_CATALOGS } from '../../../../graph/contract/wire/catalogs.js';
import type { Catalog } from '../../../../graph/contract/wire/tags/declaration.js';
import { softwareDevelopment, softwareDevelopmentProfile } from '../../../../catalogs/contract/wire/softwareDevelopment.js';
import { coreLibrary } from '../../../../catalogs/contract/wire/coreLibrary.js';
import { knowledge, knowledgeProfile } from '../../../../catalogs/contract/wire/knowledge.js';
import { shippedTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import { catalogProfileSchema, resolveTypes, storedProfile } from '../../../../graph/contract/wire/tags/profile.js';
import { Schema } from 'effect';
import { Identities, NO_NAMING } from '../../../../graph/vocabulary/identity.js';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { BEHAVIOUR_REGISTRY } from '../../../manifest.js';

const decoded = Schema.decodeUnknownResult(catalogProfileSchema);

test('the shipped profiles are valid in the profile grammar', () => {
  expect(Result.isSuccess(decoded(softwareDevelopmentProfile))).toBe(true);
  expect(Result.isSuccess(decoded(knowledgeProfile))).toBe(true);
});

test("a stored profile is the catalog's own, else the release base, and a malformed one is a failure not an empty profile", () => {
  const own = { checks: { code: true } };
  const base = { checks: { code: false } };
  expect(storedProfile({ id: 'k', profile: own, release: { profile: base } })).toEqual(Result.succeed(own));
  expect(storedProfile({ id: 'k', release: { profile: base } })).toEqual(Result.succeed(base));
  expect(storedProfile({ id: 'k' })).toEqual(Result.succeed(null));
  expect(Result.isFailure(storedProfile({ id: 'k', profile: { checks: { code: 'yes' } } }))).toBe(true);
  expect(Result.isFailure(storedProfile({ id: 'k', profile: null, release: { profile: base } }))).toBe(true);
});

test("a profile selects a type by its permanent id, so renaming the type's alias does not move the selection", () => {
  const area = shippedTypeId('software-development', 'area');
  const release = { library: 'software-development', version: 'r1', exports: ['area'], members: ['aaaa1111'] };
  const named = new Identities(['tag', 'catalog'], [{ key: 'area', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: null }], [release]);
  const renamed = new Identities(
    ['tag', 'catalog'],
    [{ key: 'area', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: { name: 'zone' } }],
    [release],
  );
  expect(resolveTypes(named, [area])).toEqual({ keys: ['area'], missing: [] });
  expect(resolveTypes(renamed, [area])).toEqual({ keys: ['area'], missing: [] });
  expect(resolveTypes(renamed, ['zone'])).toEqual({ keys: [], missing: ['zone'] });
});

test('a type nothing installed ships under that id is reported missing, never matched by its label', () => {
  const local = new Identities(['tag', 'catalog'], [{ key: 'area', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: null }], []);
  expect(resolveTypes(local, [shippedTypeId('software-development', 'area')])).toEqual({
    keys: [],
    missing: [shippedTypeId('software-development', 'area')],
  });
});

it.effect('missing creation defaults discover catalogs from compiled roles and explicit contracts', () =>
  Effect.gen(function* () {
    const catalog: Catalog = {
      id: 'handbook',
      guidance: '',
      tags: [
        { id: 'chapter', fields: {}, edges: [], gates: [], roles: { container: true }, body: { shape: 'content' }, prompt: '' },
        {
          id: 'entry',
          fields: {},
          edges: [],
          gates: [],
          roles: {},
          contracts: { 'core/leaf': { slots: {}, words: {} } },
          body: { shape: 'content' },
          prompt: '',
        },
      ],
    };
    const index = new TagIndex([], BEHAVIOUR_REGISTRY, [], NO_NAMING, null, {
      ...NO_CATALOGS,
      all: [catalog],
      byId: (id) => (id === catalog.id ? catalog : null),
    });
    for (const contract of ['core/container', 'core/leaf'] as const) {
      const outcome = yield* Effect.result(index.creationType(contract));
      if (Result.isSuccess(outcome)) return yield* Effect.die('a missing creation default succeeded');
      expect(outcome.failure.code).toBe('creation-default-missing');
      expect(outcome.failure.unblock.some((step) => step.includes(catalog.id))).toBe(true);
    }
  }),
);

const table = (declared: readonly (typeof softwareDevelopment.tags)[number][], profiles: typeof NO_NAMING.profiles) =>
  new TagIndex(declared, BEHAVIOUR_REGISTRY, [], { ...NO_NAMING, profiles });

test('file-capable system types never turn a catalog that declares no code into a code project', () => {
  const book = [...knowledge.tags, ...coreLibrary.tags];
  expect(book.some((tag) => (tag.sources ?? []).includes('file'))).toBe(true);
  expect(table(book, [knowledgeProfile]).bindsCode()).toBe(false);
  expect(table(book, []).bindsCode()).toBe(false);
  expect(table([...softwareDevelopment.tags, ...coreLibrary.tags], [softwareDevelopmentProfile]).bindsCode()).toBe(true);
});
