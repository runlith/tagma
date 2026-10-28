import { SOURCE_KINDS } from '../../../graph/contract/wire/sources.js';
import { type Catalog, sectioned, type Tag } from '../../../graph/contract/wire/tags/declaration.js';
import { EXPLANATION } from '../../../graph/contract/wire/tags/explanation.js';
import { shippedTypeId } from '../../../graph/contract/wire/tags/identity.js';
import { IMPORTS, IMPORTS_TESTS, MODULE } from '../../../graph/contract/wire/tags/moduleContract.js';
import type { CatalogProfile } from '../../../graph/contract/wire/tags/profile.js';

const FREE_EDGES = ['validates', 'relates'] as const;
const ANY_SOURCE = SOURCE_KINDS;

const module: Tag = {
  id: 'module',
  fields: {
    kind: { type: 'enum', values: ['kit', 'product', 'surface', 'substrate'] },
    id: 'string',
    entries: { type: 'schema', name: 'moduleEntries' },
    order: { type: 'schema', name: 'moduleOrder' },
  },
  edges: [...FREE_EDGES, { kind: IMPORTS, to: ['module'] }, { kind: IMPORTS_TESTS, to: ['module'] }],
  sources: ['dir', 'file'],
  gates: [{ gate: 'source-required', kinds: ['dir', 'file'] }],
  roles: { container: true },
  contracts: { [MODULE]: { slots: { id: 'id', entries: 'entries', order: 'order' }, words: {} } },
  body: { shape: 'orientation' },
  prompt:
    "A #module owns a part of the product and its dependency boundary, kept on its card: `id` keys its violations and debt, its one directory source is the root, a file source a file it owns outside it, `entries` what other modules may import of it, `imports` and `imports-tests` what its code and test code may import, `order` its floors, bottom first. Every commit's import check reads the cards; set_module writes them, measuring every enforced rule the change moves; title, body and kind are edited freely. A module stands under its part, wherever its code lies: a page for one area of what the user gets, made once the root outgrows a screen; one making up an application as a whole stands under that application's card, a group with no code of its own. Draw boundaries where dependency boundaries are real, by product meaning, never by copying the directory tree. The body is one paragraph in the product's words — why the product has it, what it owns, what it leaves to callers, a sentence each — never what fields and edges carry. Kind is its primary responsibility: kit — imported by other code; product — delivered to a user; surface — how a user or agent reaches the product; substrate — what the rest runs on. Obligations on anyone working inside it are rules. Write its subtree after reading its code, never a sample — every file whole if the module is small enough, else its exported surface — the module first, then an #explanation per lasting part needing one. An existing subtree's affected owners are read and revised, never recreated; where code contradicts the module or its explanations, correct the module first.",
};

const explanation: Tag = {
  id: 'explanation',
  fields: {},
  edges: [...FREE_EDGES],
  sources: ANY_SOURCE,
  gates: [],
  roles: {},
  contracts: { [EXPLANATION]: { slots: {}, words: {} } },
  body: { shape: 'content' },
  prompt:
    "An #explanation states a lasting part of the code a reader cannot recover from it: a contract several files or modules keep, an invariant and what breaks without it, a format, or a choice and the alternative it rejected. Its sources name the narrowest code that could contradict it, and it stands under the module owning that code, never under another leaf; each session receives it once, on first reading or writing that code. The title states the fact and reads alone. The body holds only the reason, boundary, failure prevented or trade — never the code read back: no walk through functions, no list of fields or parameters, no constant's value — say what the constant must outlast. Measurements and how it was built belong to the task that did the work. A word of totality — every, only, never — is written after reading each place it covers: a universal statement the code breaks is worse than silence. A change breaking an explanation corrects it in the same change. A plain note may also name code with sources; this tag adds delivery on code reads and writes.",
};

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
    'A #spec agrees a change the operator asks to have specified, before it is built. It stands under what it changes: a module, a capability, or the part when it spans the part. It thinks through what stands and what will stand: outcome, owners and boundaries touched, reason for the choice, checkable acceptance criteria. Split independent specs into children. Edit it in place when what is wanted changes: it always says what is wanted now. Closing its tasks does not close it: whoever ends its last task, or led its work, closes it once built, or once no longer wanted — the answer of finish_block, close_block or apply_batch that ends a task names the spec left with no open work, in this project or another. A closed spec is history, never current knowledge.',
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
    'A #task is a piece of work: it states what to do and why. It stands under what it changes — a module, a capability, or the part when it spans the part — or under the spec it implements. Link the spec it implements or the block it was discovered from. The holder claims it before working, releases it if stopping unfinished, and finishes it with the commit that carries the work. What a child thread still holds when it stops working passes to the thread that gave it the work, which ends, releases or hands on each; taking a task from another holder is a claim. A waiting task points to its blocker with waits-on; larger work may have child tasks.',
};

const rule: Tag = {
  id: 'rule',
  fields: {
    enabled: 'boolean',
    delivery: { type: 'enum', values: ['prompt', 'code'] },
    enforcement: { type: 'schema', name: 'lawEnforcement' },
  },
  edges: [...FREE_EDGES],
  sources: ANY_SOURCE,
  gates: [],
  roles: { law: 'enabled', delivery: 'delivery', enforcement: 'enforcement' },
  body: { shape: 'content' },
  prompt:
    "When the operator corrects how agents work beyond this task — what they would want from any agent tomorrow — record it as a #rule in that turn and name it in the answer. Priorities, plans and orders for now are not rules; in doubt, offer one in a line. One norm per rule, split where obligations change independently, as short as the norm allows: it rides every thread it reaches. The title states the obligation; the body holds only what the title cannot work without — a condition, an exception or an example — in plain words for a reader with no context, and stays empty when the title is enough. No internal codes, section numbers, references to specs and tasks, history, measurements, trials, or what is removed or not in force: those go in the spec or note it relates to. Distinguish requirements from recommendations. A rule is an obligation, never a substitute for explaining a mechanism; code breaking it is a violation to fix or escalate, never an exception to record. `delivery: prompt` stands in every thread's startup instructions, for a norm across the project or wider than the code it was born in; `code` arrives when an agent reads or writes the code its sources name, for a norm about that code. Unset, a rule with sources is `code`, one without `prompt`; switching keeps the sources. A rule stands under what it governs: the module its sources name, or the root for law over the whole project; its place serves the reader, and its delivery and sources decide who receives it. Nesting overrides no ancestor. A global-graph rule has no sources and rides every project. A rule is active unless enabled is false. A measurable rule is enforced through enforce_rule alone: it writes the enforcement document — the key of its inspection in `tagma.config.ts`, strictness (note, watch or gate), triggering operations before or after, debt — makes every violation then standing debt, and is the only way strictness moves or debt grows — growing debt is a loosening done in the open; the re-measure driver only retires vanished debt and records or drops escapes. The rule measures the code its sources name, or the whole project without sources, whatever its delivery; only title and body reach a prompt. Each debt entry is a standing violation, never an exception, owned by the task or spec that removes it, retired once that violation is gone; at gate a violation outside the debt is refused, never recorded as allowed. Refused code belonging to another subject moves to its owner; code belonging where it stands, in a place shaped wrong, lands with its violation as debt owned by a new task naming the area and what was seen — the worker that met the gate neither redesigns the area nor declares the rule wrong: that view goes into the task. Whoever takes a debt task first finds how far its cause reaches, one file or a whole area; work over an area takes over the debt of every file it covers. A rule wrong for a class of code is changed for that class in its inspection in `tagma.config.ts`, on the operator's word. A rule switched off, replaced or trashed is no longer enforced.",
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
    'A #research node records a reading of a system outside this project; `source` names the system and the checkout, URL or version read. Separate observation from inference and say what the evidence does not establish; a measurement whose experiment was not kept says so: the record alone cannot reproduce it. Split a broad investigation by independent questions. A node resting on a reading relates to it and carries the versions and conditions it established, never a generalized result. Research says nothing about whether this project implements what it studied.',
};

const LIBRARY = 'software-development';

const owned = (exported: string) => shippedTypeId(LIBRARY, exported);

export const softwareDevelopmentProfile: CatalogProfile = {
  batch: [
    {
      type: owned('research'),
      field: 'source',
      unblock: 'set `source: { name: "<system>", ref: "<checkout|url|version>" }` — the system the reading was taken from and where',
    },
  ],
  checks: { code: true },
};

export const softwareDevelopment: Catalog = {
  id: LIBRARY,
  guidance: `The software-development catalog connects product understanding, accepted changes and the work realizing them.

When the product's behaviour changes, edit the block that describes it; never write a second block about the same behaviour beside it.

A subtree offered as an example for other work is first read against the code by someone who did not write it: a qualified body does not repair an overbroad title.

Write for a competent reader only the distinctions, conditions and reasons they cannot reliably infer — never what code or structure already says; write from the code, never its comments: the graph cuts prose, it does not move it. An orientation body is as short as its reason; a spec, research reading or rule takes the space its complete subject needs. Another subject is another node, never a longer body; one subject's conditions stay together. Examples earn their place by resolving ambiguity. An explicit data constraint names the real consuming contract requiring it; the reason, not a character cap, measures quality. Precision is judged per sentence: a title or body promising more than the code holds is a defect.`,
  tags: [module, explanation, spec, task, rule, idea, research].map(sectioned),
  profile: softwareDevelopmentProfile,
};
