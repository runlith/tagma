import { SOURCE_KINDS } from '../../../graph/contract/wire/sources.js';
import { type Catalog, sectioned, type Tag } from '../../../graph/contract/wire/tags/declaration.js';
import { shippedTypeId } from '../../../graph/contract/wire/tags/identity.js';
import type { CatalogProfile } from '../../../graph/contract/wire/tags/profile.js';

const FREE_EDGES = ['validates', 'relates'] as const;
const ANY_SOURCE = SOURCE_KINDS;

const LIBRARY = 'work';

const spec: Tag = {
  id: 'spec',
  fields: { status: { type: 'enum', values: ['open', 'closed'] } },
  edges: [...FREE_EDGES],
  sources: ANY_SOURCE,
  gates: [
    { gate: 'transition', field: 'status', from: 'open', to: 'closed' },
    { gate: 'transition', field: 'status', from: 'closed', to: 'open' },
    { gate: 'open-children', tag: 'task' },
  ],
  roles: { status: { field: 'status', initial: 'open', closed: 'closed' }, spec: true },
  body: { shape: 'content' },
  prompt:
    'A #spec agrees a change the operator asks to have specified, before it is built. It thinks through what stands and what will stand: outcome, owners and boundaries touched, reason for the choice, checkable acceptance criteria. Split independent specs into children. Edit it in place when what is wanted changes: it always says what is wanted now. Closing its tasks does not close it: whoever ends its last task, or led its work, closes it once built, or once no longer wanted — the answer of finish_block, close_block or apply_batch that ends a task names the spec left with no open work, in this project or another. A closed spec is history, never current knowledge.',
};

const task: Tag = {
  id: 'task',
  fields: { status: { type: 'enum', values: ['open', 'in_work', 'done', 'closed'] }, holder: 'session' },
  edges: [...FREE_EDGES, 'waits-on', 'implements'],
  sources: ANY_SOURCE,
  gates: [
    { gate: 'transition', field: 'status', from: 'open', to: 'in_work' },
    { gate: 'transition', field: 'status', from: 'open', to: 'done' },
    { gate: 'transition', field: 'status', from: 'open', to: 'closed' },
    { gate: 'transition', field: 'status', from: 'in_work', to: 'open' },
    { gate: 'transition', field: 'status', from: 'in_work', to: 'done' },
    { gate: 'transition', field: 'status', from: 'in_work', to: 'closed' },
    { gate: 'transition', field: 'status', from: 'done', to: 'open' },
    { gate: 'transition', field: 'status', from: 'closed', to: 'open' },
    { gate: 'open-children', tag: 'task' },
  ],
  roles: {
    status: { field: 'status', initial: 'open', claimed: 'in_work', done: 'done', closed: 'closed' },
    holder: 'holder',
    work: true,
  },
  body: { shape: 'orientation' },
  prompt:
    'A #task is a piece of work: it states what to do and why. Link the spec it implements or the block it was discovered from. The holder claims it before working, releases it if stopping unfinished, and finishes it once the work happened. What a child thread still holds when it stops working passes to the thread that gave it the work, which ends, releases or hands on each; inside one thread tree a holder only notes who is on a task, and any member finishes or attributes it. A waiting task points to its blocker with waits-on; larger work may have child tasks.',
};

const idea: Tag = {
  id: 'idea',
  fields: { status: { type: 'enum', values: ['open', 'closed'] } },
  edges: [...FREE_EDGES],
  sources: ANY_SOURCE,
  gates: [
    { gate: 'transition', field: 'status', from: 'open', to: 'closed' },
    { gate: 'transition', field: 'status', from: 'closed', to: 'open' },
  ],
  roles: { status: { field: 'status', initial: 'open', closed: 'closed' } },
  body: { shape: 'content' },
  prompt:
    'An #idea keeps a worthwhile possibility not yet accepted: the question, the motivation, what would inform the choice, its uncertainty explicit. It obliges no implementation and may be closed once not useful; an accepted target is a #spec. A passing question need not become a node.',
};

const research: Tag = {
  id: 'research',
  fields: { source: { type: 'schema', name: 'researchSource' } },
  edges: [...FREE_EDGES],
  gates: [{ gate: 'required', field: 'source' }],
  roles: {},
  body: { shape: 'content' },
  prompt:
    'A #research node records a reading of something outside this project; `source` names what was read and where — its URL, version or copy. Separate observation from inference and say what the evidence does not establish; a measurement whose experiment was not kept says so: the record alone cannot reproduce it. Split a broad investigation by independent questions. A node resting on a reading relates to it and carries the versions and conditions it established, never a generalized result. Research says nothing about whether this project does what it studied.',
};

const workProfile: CatalogProfile = {
  batch: [
    {
      type: shippedTypeId(LIBRARY, 'research'),
      field: 'source',
      unblock: 'set `source: { name: "<what was read>", ref: "<url|version|checkout>" }` — what the reading was taken from and where',
    },
  ],
};

export const work: Catalog = {
  id: LIBRARY,
  guidance:
    'The work catalog carries work from possibility to result: an #idea keeps a possibility, a #spec agrees a change before it is built, #task blocks do the work, and #research keeps a reading from outside the project that the others rest on.',
  tags: [spec, task, idea, research].map(sectioned),
  profile: workProfile,
};
