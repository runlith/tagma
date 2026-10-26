import { Effect } from 'effect';
import { writes } from '../../../../platform/contract/service/writes.js';
import { Catalogs } from '../../../../graph/contract/wire/catalogs.js';
import { type Catalog, sectioned } from '../../../../graph/contract/wire/tags/declaration.js';
import { installCatalogs, installRoad } from '../../../../graph/vocabulary/activation.js';
import { projecting, referencing } from '../../../../graph/store/actWrites.js';
import { block } from '../../../../graph/store/tables.js';

export const notes: Catalog = {
  id: 'notes',
  guidance:
    'The notes catalog organizes information worth returning to. Use a note for a subject, a person for someone other records refer to, a meeting for an event and its participants, and a recipe for a repeatable method. Link existing records rather than copying their contents. Name an external source when a statement depends on one. Record uncertainty honestly and create a node only when the material deserves its own address. This vocabulary does not impose a software implementation workflow.',
  tags: [
    sectioned({
      id: 'note',
      fields: {},
      edges: ['relates'],
      gates: [],
      roles: {},
      body: { shape: 'content' },
      prompt:
        'A `#note` is a titled body and nothing else: what you wanted to keep, as long as it needs to be. A note about another record links it rather than copying it.',
    }),
    sectioned({
      id: 'person',
      fields: {},
      edges: ['relates'],
      gates: [],
      roles: {},
      body: { shape: 'content' },
      prompt: 'A `#person` is somebody the notebook refers to; other nodes point at it rather than repeating the name.',
    }),
    sectioned({
      id: 'meeting',
      fields: { held: 'date', attendees: { type: 'ref', tag: 'person', many: true } },
      edges: ['relates'],
      gates: [{ gate: 'required', field: 'held' }],
      roles: {},
      body: { shape: 'content' },
      prompt: 'A `#meeting` is what was said and decided, on the day it was held, by the people it names.',
    }),
    sectioned({
      id: 'recipe',
      fields: {},
      edges: ['relates'],
      gates: [],
      roles: {},
      body: { shape: 'content' },
      prompt: 'A `#recipe` is the method, at whatever length the method takes; nothing measures how long it is.',
    }),
  ],
  profile: { checks: { code: false } },
};

const installing = writes('fixture.notes', [block], projecting, referencing);

export const installNotes = Effect.fn('fixture.installNotes')(function* (projectId: number) {
  const road = yield* installRoad;
  const shipped = Catalogs.of({
    key: road.shipped.key,
    all: [...road.shipped.all, notes],
    byId: (id) => (id === notes.id ? notes : road.shipped.byId(id)),
    declaring: (id) => [...road.shipped.declaring(id), ...(notes.tags.some((tag) => tag.id === id) ? [notes.id] : [])],
  });
  yield* road.act.unit(installing, installCatalogs({ ...road, shipped }, projectId, [notes.id]));
});
