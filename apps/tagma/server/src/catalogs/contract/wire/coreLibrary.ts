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
    "A #reflection records friction with Tagma itself: what was invoked, what should have happened, what actually happened — each concrete, useful evidence or nuance in the body. A measured cost is evidence, frustration alone is not. Read the refusal before blaming the instrument; product defects belong to the product's owner. It is an observation, not a promise to implement; separate finished work answers it. A repeated sighting keeps its own evidence, never rewriting the first report.",
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

const rule: Tag = {
  id: 'rule',
  fields: {
    enabled: 'boolean',
    delivery: { type: 'enum', values: ['prompt', 'code', 'finding'] },
    enforcement: { type: 'schema', name: 'lawEnforcement' },
  },
  edges: [...FREE_EDGES],
  sources: ANY_SOURCE,
  gates: [],
  roles: { law: 'enabled', delivery: 'delivery', enforcement: 'enforcement' },
  body: { shape: 'content' },
  prompt:
    "A #rule is a standing obligation on agents' work in this project. One norm per rule, split where obligations change independently, as short as the norm allows: it rides every thread it reaches. The title states the obligation; the body holds only what the title cannot work without — a condition, an exception or an example — in plain words for a reader with no context, and stays empty when the title is enough. No internal codes, section numbers, references to other blocks, history, measurements, trials, or what is removed or not in force: those go in a block the rule relates to. Distinguish requirements from recommendations. A rule is an obligation, never a substitute for explaining a mechanism; work breaking it is a violation to fix or escalate, never an exception to record. `delivery` decides who receives the text, and the narrowest reach that serves the norm is chosen. `prompt` stands in every thread's startup instructions for as long as the rule lives: only for a norm every thread needs whatever it works on. `code` arrives when an agent reads or writes a file its sources name: a norm about particular files, sourced to them. `finding` reaches nobody in advance and stands in the results of the rule's check: only for a norm whose every breach that check catches; a norm an agent must know before acting stays `code` or `prompt` even with a check. Unset, a rule with sources is `code`, one without `prompt`; switching keeps the sources. Nesting overrides no ancestor. A global-graph rule has no sources and rides every project. A rule is active unless enabled is false; one switched off, replaced or trashed binds nobody. A measurable rule can be enforced by a check `tagma.config.ts` declares over the project's files, through enforce_rule alone; the `rules` skill carries checks, debt and enforcement.",
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
    'The core library ships what every Tagma graph may carry — #rule law and the system types — and names no domain workflow: a project is software, a notebook or anything else by the catalogs installed beside it. Every block, an untagged note included, connects to any block of its project or another with relates, and to its origin with discovered-from. In every project, an untagged note may carry file, directory or symbol sources for ownership, navigation and search; sources move and transfer with the same operations as other blocks. To deliver a note to file readers and writers, use a type supporting core/explanation. Tagged nodes keep their declared source kinds.',
  tags: [reflection, view, rule].map(sectioned),
  profile: coreProfile,
};
