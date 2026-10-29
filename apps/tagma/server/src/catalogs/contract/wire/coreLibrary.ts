import { SOURCE_KINDS } from '../../../graph/contract/wire/sources.js';
import { type Catalog, sectioned, type Tag } from '../../../graph/contract/wire/tags/declaration.js';
import { CORE_LIBRARY, shippedTypeId } from '../../../graph/contract/wire/tags/identity.js';
import type { CatalogProfile } from '../../../graph/contract/wire/tags/profile.js';
import { REFLECTION } from '../../../graph/contract/wire/tags/reflection.js';
import { SELECTION } from '../../../graph/contract/wire/tags/selection.js';

const FREE_EDGES = ['validates', 'relates'] as const;
const ANY_SOURCE = SOURCE_KINDS;

export const reflection: Tag = {
  id: 'reflection',
  fields: {
    command: { type: 'schema', name: 'line' },
    expected: { type: 'schema', name: 'line' },
    actual: { type: 'schema', name: 'line' },
  },
  edges: [...FREE_EDGES],
  sources: ANY_SOURCE,
  gates: [
    { gate: 'required', field: 'command' },
    { gate: 'required', field: 'expected' },
    { gate: 'required', field: 'actual' },
  ],
  roles: { observation: true },
  body: { shape: 'content' },
  prompt:
    "A #reflection records friction with Tagma itself: what was invoked, what should have happened, what actually happened — each concrete, useful evidence or nuance in the body. It stands under the module declaring the operation or tool it is about, never under another leaf. A measured cost is evidence, frustration alone is not. Read the refusal before blaming the instrument; product defects belong to the product's owner. It is an observation, not a promise to implement; separate finished work answers it. A repeated sighting keeps its own evidence, never rewriting the first report.",
};

export const view: Tag = {
  id: 'view',
  fields: { query: { type: 'schema', name: 'blockQuery' }, layout: { type: 'schema', name: 'viewLayout' } },
  edges: [...FREE_EDGES],
  gates: [{ gate: 'required', field: 'query' }],
  roles: { leaf: true },
  body: { shape: 'orientation' },
  prompt:
    'A #view saves a selection worth a durable address for repeated use, not every search: say what it answers; opening it runs its query against its own scope — a live reading, not a list to maintain.',
};

export const coreProfile: CatalogProfile = {
  defaults: [
    { contract: REFLECTION, type: shippedTypeId(CORE_LIBRARY, 'reflection') },
    { contract: SELECTION, type: shippedTypeId(CORE_LIBRARY, 'view') },
  ],
};

export const coreLibrary: Catalog = {
  id: CORE_LIBRARY,
  guidance:
    'The core library ships the system types every Tagma graph may carry and names no domain workflow: a project is software, a notebook or anything else by the catalogs installed beside it. Every block, an untagged note included, connects to any block of its project or another with relates, and to its origin with discovered-from. In every project, an untagged note may carry file, directory or symbol sources for ownership, navigation and search; sources move and transfer with the same operations as other blocks. To deliver a note to file readers and writers, use a type supporting core/explanation. Tagged nodes keep their declared source kinds.',
  tags: [reflection, view].map(sectioned),
  profile: coreProfile,
};
