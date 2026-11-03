import { SOURCE_KINDS } from '../../../graph/contract/wire/sources.js';
import { type Catalog, sectioned, type Tag } from '../../../graph/contract/wire/tags/declaration.js';
import { EXPLANATION } from '../../../graph/contract/wire/tags/explanation.js';
import { CORE_LIBRARY, shippedTypeId } from '../../../graph/contract/wire/tags/identity.js';
import { IMPORTS, IMPORTS_TESTS, MODULE } from '../../../graph/contract/wire/tags/moduleContract.js';
import type { CatalogProfile } from '../../../graph/contract/wire/tags/profile.js';
import { work } from './work.js';

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
    "A #module owns a part of the product and its dependency boundary, kept on its card: `id` keys its violations and debt, its one directory source is the root, a file source a file it owns outside it, `entries` what other modules may import of it, `imports` and `imports-tests` what its code and test code may import, `order` its floors, bottom first. Every commit's import check reads the cards; set_module writes them, measuring every enforced rule the change moves; title, body and kind are edited freely. A module stands under the area of what the user gets, wherever its code lies; one making up an application as a whole stands under that application's card, a group with no code of its own. Draw boundaries where dependency boundaries are real, by product meaning, never by copying the directory tree. The body is one paragraph in the product's words — why the product has it, what it owns, what it leaves to callers, a sentence each — never what fields and edges carry. Kind is its primary responsibility: kit — imported by other code; product — delivered to a user; surface — how a user or agent reaches the product; substrate — what the rest runs on. Obligations on anyone working inside it are rules. Write its subtree after reading its code, never a sample — every file whole if the module is small enough, else its exported surface — the module first, then an #explanation per lasting part needing one. An existing subtree's affected owners are read and revised, never recreated; where code contradicts the module or its explanations, correct the module first.",
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
    "An #explanation states a lasting part of the code a reader cannot recover from it: a contract several files or modules keep, an invariant and what breaks without it, a format, or a choice and the alternative it rejected. Its sources name the narrowest code that could contradict it; each session receives it once, on first reading or writing that code. The title states the fact and reads alone. The body holds only the reason, boundary, failure prevented or trade — never the code read back: no walk through functions, no list of fields or parameters, no constant's value — say what the constant must outlast. Measurements and how it was built belong to the task that did the work. A word of totality — every, only, never — is written after reading each place it covers: a universal statement the code breaks is worse than silence. A change breaking an explanation corrects it in the same change. A plain note may also name code with sources; this tag adds delivery on code reads and writes.",
};

export const softwareDevelopmentProfile: CatalogProfile = { checks: { code: true } };

export const softwareDevelopment: Catalog = {
  id: 'software-development',
  guidance: `The software-development catalog connects product understanding, accepted changes and the work realizing them.

When the product's behaviour changes, edit the block that describes it; never write a second block about the same behaviour beside it.

A subtree offered as an example for other work is first read against the code by someone who did not write it: a qualified body does not repair an overbroad title.

Write for a competent reader only the distinctions, conditions and reasons they cannot reliably infer — never what code or structure already says; write from the code, never its comments: the graph cuts prose, it does not move it. An orientation body is as short as its reason; a spec, research reading or rule takes the space its complete subject needs. Another subject is another node, never a longer body; one subject's conditions stay together. Examples earn their place by resolving ambiguity. An explicit data constraint names the real consuming contract requiring it; the reason, not a character cap, measures quality. Precision is judged per sentence: a title or body promising more than the code holds is a defect.`,
  tags: [module, explanation].map(sectioned),
  profile: softwareDevelopmentProfile,
  requires: [work.id],
  sections: [
    {
      type: shippedTypeId(CORE_LIBRARY, 'rule'),
      text: "Over code: a norm about particular code is `code`, sourced to that code. `finding` suits a norm whose every breach its check catches wherever it appears, sourced to the code the check must look at or to nothing for the whole project; its earliest result is the check's earliest run — at landing, or seconds after a write for a check that judges one file alone and runs after edit and write. A norm with no check that can be broken anywhere in the code gets a check offered and, until then, `code` on the code it governs.",
    },
    { type: shippedTypeId(work.id, 'task'), text: 'A task that changes code is finished with the commit that carries its work.' },
    { type: shippedTypeId(work.id, 'research'), text: 'A reading of code names the checkout, commit or version read.' },
  ],
};
