import { Schema } from 'effect';
import { SHAPE_REFUSALS } from '../../../change-record/contract/wire/shape.js';
import {
  CheckAnswer,
  CommitRecord,
  EnforcedAnswer,
  type EnforcementPlan,
  InspectionsReading,
  CHECK_OVER,
  reachSaid,
} from './enforcement.js';
import { KEY } from '../../../config/contract/wire/config.js';
import { ENFORCED_STRICTNESS, triggerSchema, triggersSaid } from '../../../graph/contract/wire/enforcement.js';
import { blockRef } from '../../../graph/contract/wire/fields.js';
import { placedCursor, placeRole, projectField } from '../../../platform/contract/wire/place.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { INSPECTIONS, VIOLATIONS } from './pages.js';
import { ENGINES, EnforcementReading } from './engines.js';
import { ModuleSet, type ModulesPlan, ModulesSet } from './modules.js';
import { type Raised } from '@runlith/agent/permissions';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { DEBT_GROWS, DEBT_UNOWNED } from '../../../platform/contract/wire/conditions.js';

type Consenting = { readonly consents: readonly Raised[] };

const fingerprint = Schema.String.check(Schema.isMinLength(1));

const inspectionKey = Schema.String.check(Schema.isPattern(KEY));

const seconds = (ms: number | null): string => (ms === null ? 'not measured' : `${(ms / 1000).toFixed(1)} s`);

const debtLine = (plan: EnforcementPlan): string => {
  const kept = plan.debt.after.map((entry) => `${entry.fingerprint} (${entry.owner})`);
  return kept.length === 0 ? 'none' : kept.join(', ');
};

export const ENFORCEMENT_OPERATIONS = {
  enforce_rule: operation('enforce_rule', {
    approval: { ...ASKS_IN_REVIEW, when: [DEBT_GROWS, DEBT_UNOWNED] },
    callers: 'any',
    waits: [],
    lifetimes: [],
    place: 'project',
    effect: 'write',
    identity: 'manual',
    subject: 'none',
    answer: arms({ ok: { block: Schema.Struct({ name: Schema.String }), ...EnforcedAnswer.fields } }),
    doors: { http: 'perform' },
    tool: { capability: 'graph' },
    meaning:
      "Set a rule's enforcement — strictness, triggers and inspection — measured over the rule's reach at HEAD of the selected checkout, whose graph copy its landings are judged by.",
    grammar:
      "`checkout` selects a registered root; absent, an explicitly aimed cwd or branch, otherwise the only checkout holding this session's lines in the rule's project, or its main checkout when none does. Several held checkouts require an explicit choice. If the rule is absent from that checkout's graph copy, the call refuses `not-found`. The measurement, the session change searched by absorb and the graph copy written all belong to that checkout. `prepare` runs the inspection over the reach — the code the rule's sources name intersected with the inspection's base, the whole project for a rule without sources — and the confirmation names what the write records. `inspection` is a key of `tagma.config.ts` at HEAD, the version the measurement reads: what it judges and how is that file's, and changes by a commit of it. A key HEAD does not declare refuses `inspection-unknown`; check_rules with `inspection` tries a key the session's uncommitted config declares before it lands. A first enforcement takes `inspection` and makes every violation found debt, each with an owner in `owners` or else `owner`: a standing task or spec that removes it. The result carries the key, debt and escape counts; read_enforcement with the rule returns its standing policy. A later one keeps the debt still found; `absorb` — the fingerprints, or `all` — with an owner in `owners` or `owner` makes anything else debt. A named fingerprint absent at HEAD is looked for in the calling session's uncommitted change, judged as check_rules over the change judges it: found there, it becomes debt held for that change — it stands until a landing carries it, and retires once its file changes without it. A violation left outside the debt, and an entry whose owner does not stand, is recorded as escaped instead and counted in `escaped`: under review the operator is asked first, under trust and bypass it lands. `off` removes the document; the journal keeps it. `base` names the revision of the enforcement the input was built on — read_enforcement with the rule answers it as the engine's `revision` — and a write refuses `enforcement-stale` when the rule's strictness, triggers or inspection moved since, so two callers restating one list never erase each other; the answer names the new revision and the graph copy written. A write also refuses when the document moved since prepare, or HEAD changed what the measurement stands on: a file it read, or a path added or removed under the base. `on` names the operations whose passage runs the rule: `before` judges what the operation is about to do and, at gate, refuses it; `after` runs once it is done, where gate acts as watch. submit_work and merge_worktree judge the tree they land against its base, edit and write the file's new text against HEAD (after only), and an operation that changes nothing judges HEAD; `trigger-unknown` refuses any other. With `on` empty the rule runs only through check_rules.",
    input: Schema.Struct({
      project: projectField,
      blockId: blockRef.annotate({ description: 'The #rule whose enforcement is set.' }),
      checkout: Schema.optional(Schema.NonEmptyString.annotate(placeRole('checkout'))).annotate({
        description: 'The registered checkout root whose HEAD, session change and graph copy this enforcement uses.',
      }),
      base: Schema.NullOr(Schema.String).annotate({
        description:
          "The revision of the rule's enforcement this input was built on, as read_enforcement with the rule answers it; null when the rule carries none. A write on any other refuses `enforcement-stale`.",
      }),
      strictness: Schema.Literals(ENFORCED_STRICTNESS).annotate({
        description: '`note` delivers and runs nowhere, `watch` runs and names, `gate` refuses; `off` removes the enforcement.',
      }),
      on: Schema.optional(Schema.Array(triggerSchema)).annotate({
        description:
          'The operations that run it, each `{ op, phase }` with phase `before` or `after`; absent, what stands, else none — the rule then runs only through check_rules. submit_work names every commit: its triggers also judge a `git commit` into a checkout of this project and commit_checkout.',
      }),
      inspection: Schema.optional(inspectionKey).annotate({
        description: 'The key of the inspection in `tagma.config.ts` at HEAD. Absent, what stands.',
      }),
      owners: Schema.optional(Schema.Record(fingerprint, blockRef)).annotate({
        description: 'Fingerprint → the standing task or spec that removes that debt entry.',
      }),
      owner: Schema.optional(blockRef).annotate({
        description:
          'The standing task or spec that owns every new debt entry `owners` does not name: all the violations a first enforcement finds, or all that `absorb` takes.',
      }),
      absorb: Schema.optional(Schema.Union([Schema.Literal('all'), Schema.Array(fingerprint)])).annotate({
        description:
          'Fingerprints found outside the debt that become debt, or `all` for every one found; each owned by `owners` or `owner`.',
      }),
    }),
    refusals: [
      'not-found',
      'deleted',
      'out-of-scope',
      'not-enforced',
      'superseded',
      'rule-disabled',
      'inspection-required',
      'inspection-unknown',
      'config-invalid',
      'config-unstored',
      'config-unrunnable',
      'git-unavailable',
      'pack-unused',
      'reach-empty',
      'trigger-unknown',
      'inspection-failed',
      'module-map-invalid',
      'enforcement-stale',
      'root-unproven',
      'multiple-checkouts',
    ],
    confirmation: (input: { readonly blockId: string }, prepared?: EnforcementPlan) =>
      prepared === undefined
        ? { summary: `Set the enforcement of ${input.blockId}?` }
        : prepared.strictness === 'off'
          ? {
              summary: `Remove the enforcement of ${prepared.rule} ${prepared.title}?`,
              facts: [
                {
                  label: 'was',
                  value:
                    prepared.was === null
                      ? 'nothing'
                      : prepared.was === 'unreadable'
                        ? 'a document that does not decode'
                        : `${prepared.was.strictness}, ${triggersSaid(prepared.was.on)}`,
                },
              ],
              consequence: 'The rule stays delivered and runs nowhere; the journal keeps the document removed.',
            }
          : {
              summary: `Enforce ${prepared.rule} ${prepared.title} at ${prepared.strictness}, ${triggersSaid(prepared.on ?? [])}?`,
              facts: [
                ...(prepared.inspection === null ? [] : [{ label: 'inspection', value: prepared.inspection }]),
                { label: 'measured at', value: prepared.head ?? 'nothing' },
                { label: 'reach', value: reachSaid(prepared.places) },
                { label: 'debt', value: debtLine(prepared) },
                ...(prepared.absorbed.length === 0
                  ? []
                  : [{ label: 'absorbed', value: prepared.absorbed.map((entry) => `${entry.fingerprint} (${entry.owner})`).join(', ') }]),
                ...(prepared.retired.length === 0 ? [] : [{ label: 'retired', value: prepared.retired.join(', ') }]),
                { label: 'duration', value: seconds(prepared.ms) },
              ],
            },
    confirmLabel: 'Enforce',
    presentation: { running: "Setting a rule's enforcement", done: "Set a rule's enforcement" },
    subjects: () => [],
    raises: (_input: unknown, prepared?: Consenting) => prepared?.consents ?? [],
  }),

  set_module: operation('set_module', {
    approval: { ...ASKS_IN_REVIEW, when: [DEBT_GROWS, DEBT_UNOWNED] },
    callers: 'any',
    waits: [],
    lifetimes: [],
    place: 'project',
    effect: 'write',
    identity: 'manual',
    subject: 'none',
    answer: arms({ ok: ModulesSet.fields, preview: ModulesSet.fields }),
    doors: { http: 'perform' },
    tool: { capability: 'graph' },
    meaning:
      "Write module boundaries — create, move or remove #module cards and set each one's id, root, cuts, entries, relations and order — and re-measure every enforced rule that runs over the module map, in one write.",
    grammar:
      "`modules` names every module the change touches. A module is found by its `id`, or by `block` when its id changes or it has none; an unknown id is a new card, born with `title` and `root` under `parent`: the module holding it, or the project root named explicitly. A field left out keeps what stands. `entries`, `cuts`, `imports` and `importsTests` change by `{ put, drop }` or by `{ replace }` (the whole collection); an entry is keyed by its `at`, and `entries: { replace: [] }` closes the module. A module is referenced by its id, `{ id }`, or the name of its card, `{ block }`, so the `for` values read_block shows go back unchanged; a string that is the id of one module and the name of another refuses with both candidates. References resolve against the modules as this call leaves them. A path sent in `root`, `put`, `replace` or `order` must exist in the working tree, as must the entries a new root leaves behind; a `drop` and an untouched entry need none. Stored entries or order that do not read change only by `replace`. Every fault of the request is named in one refusal and nothing is written. `preview: true` measures at HEAD each enforced rule whose map changes against the proposed map and returns status `preview`, debt changes and escaped fingerprints without writing cards or enforcement. A violation outside debt becomes debt where `absorb` names it, or is `all`, with an owner in `owners` or `owner`, and remains escaped otherwise. Without preview, the call measures again and writes the cards and enforcement together; its answer starts with each re-measured rule's escaped count and first fingerprints. A change to the cards, map rules' reach or HEAD paths a measurement stood on between preparation and writing refuses `enforcement-stale`; call again to measure the state that stands. The text and `kind` of a card are update_block's.",
    input: Schema.Struct({
      project: projectField,
      modules: Schema.Array(ModuleSet).check(Schema.isMinLength(1)).annotate({ description: 'The modules this change writes.' }),
      preview: Schema.optional(Schema.Boolean).annotate({
        description:
          'Measure the proposed map at HEAD and return its debt changes and escaped fingerprints without writing cards or enforcement.',
      }),
      owners: Schema.optional(Schema.Record(fingerprint, blockRef)).annotate({
        description: 'Fingerprint → the standing task or spec that removes that debt entry.',
      }),
      owner: Schema.optional(blockRef).annotate({
        description: 'The standing task or spec that owns every absorbed entry `owners` does not name.',
      }),
      absorb: Schema.optional(Schema.Union([Schema.Literal('all'), Schema.Array(fingerprint)])).annotate({
        description:
          "Fingerprints the new map finds outside a rule's debt that become debt, or `all` for every one found; each owned by `owners` or `owner`.",
      }),
    }),
    refusals: [
      'not-found',
      'deleted',
      'out-of-scope',
      'module-shape',
      'parent-required',
      'field-invalid',
      'field-required',
      'tag-undeclared',
      'not-enforced',
      'superseded',
      'rule-disabled',
      'inspection-required',
      'inspection-unknown',
      'config-invalid',
      'config-unstored',
      'config-unrunnable',
      'git-unavailable',
      'pack-unused',
      'trigger-unknown',
      'inspection-failed',
      'module-map-invalid',
      'reach-empty',
      'enforcement-stale',
    ],
    confirmation: (input: { readonly preview?: boolean }, prepared?: ModulesPlan) =>
      prepared === undefined
        ? { summary: `${input.preview === true ? 'Preview' : 'Write'} module boundaries?` }
        : {
            summary: `${input.preview === true ? 'Preview' : 'Write'} ${prepared.modules.length} module(s): ${prepared.modules.map((one) => `${one.act} ${one.id}`).join(', ')}?`,
            facts: prepared.rules.map((one) => ({
              label: one.rule,
              value: `escaped ${one.escaped.length}, debt ${one.debt.before} → ${one.debt.after}${one.absorbed.length === 0 ? '' : `, absorbed ${one.absorbed.map((entry) => `${entry.fingerprint} (${entry.owner})`).join(', ')}`}${one.retired.length === 0 ? '' : `, retired ${one.retired.join(', ')}`}`,
            })),
          },
    confirmLabel: 'Write',
    presentation: { running: 'Writing module boundaries', done: 'Wrote module boundaries' },
    subjects: () => [],
    raises: (_input: unknown, prepared?: { readonly measured: readonly Consenting[] }) =>
      (prepared?.measured ?? []).flatMap((one) => one.consents),
  }),

  read_inspections: operation('read_inspections', {
    approval: ASKS_NEVER,
    callers: 'any',
    waits: [],
    lifetimes: [],
    place: 'project',
    effect: 'read',
    identity: 'none',
    subject: 'head',
    page: INSPECTIONS,
    answer: arms({ ok: InspectionsReading.fields }),
    doors: { http: 'perform' },
    tool: { capability: 'graph' },
    meaning:
      "Read the inspections `tagma.config.ts` can describe: one line per function of `@runlith/tagma/rules` this project's HEAD can use, or one function's signature, fingerprint unit, reach and refusal ways, or what a key of the config at HEAD resolves to and the rules naming it.",
    grammar:
      'Without `name` or `key` the answer is a page of `limit` functions with the total beside it. A function `name` (`Files.maxLines`) answers its call signature and referenced types from the SDK declarations: what tagma.config.ts calls. A builtin id (`size`, `names`, `platforms`) answers its params schema, with every default and field description. `key` answers the builtin params or function signature, the description the key resolves to at HEAD with defaults filled in, and the enforced rules naming it; read_config lists the keys. `limitations` adds what the inspection cannot see. A builtin that takes the module map runs over the map the module cards draw, which `map` answers whole.',
    input: Schema.Struct({
      project: projectField,
      name: Schema.optional(Schema.NonEmptyString).annotate({
        description: 'A function of `@runlith/tagma/rules` or `/rules/effect` (`Loading.forbid`), or a builtin id (`loads`).',
      }),
      key: Schema.optional(Schema.NonEmptyString).annotate({
        description: 'A key of the inspections `tagma.config.ts` declares at HEAD; not with `name`.',
      }),
      limitations: Schema.optional(Schema.Boolean).annotate({
        description: 'With `name` or `key`: add what the inspection cannot see.',
      }),
      limit: limitOf(INSPECTIONS),
      cursor: placedCursor,
      map: Schema.optional(Schema.Boolean).annotate({
        description: 'Answer the module map the server assembles from the module cards, with what keeps it from holding together.',
      }),
    }),
    refusals: [
      'bad-cursor',
      'cursor-stale',
      'field-invalid',
      'inspection-failed',
      'not-found',
      'no-root',
      'config-invalid',
      'config-unstored',
      'config-unrunnable',
      'git-unavailable',
    ],
    confirmation: () => ({ summary: 'Read the inspections this server offers?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the inspections', done: 'Read the inspections' },
    subjects: () => [],
  }),

  check_rules: operation('check_rules', {
    approval: ASKS_NEVER,
    callers: 'any',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    subject: 'head',
    place: 'project',
    page: VIOLATIONS,
    answer: arms({ ok: CheckAnswer.fields }),
    doors: { http: 'perform' },
    tool: { capability: 'shell', needs: ['shared', 'history'] },
    meaning:
      "Run enforced rules, or one unsaved inspection, over this session's change, over what a checkout's index would commit, or over HEAD now, and answer what they find — recording nothing.",
    grammar:
      "`over: \"change\"` (the default) selects one checkout as submit_work does — explicit `checkout`, the main checkout of `project`, or the only checkout holding this session's lines — and builds the tree submit_work would land from its selected lines on a temporary index, judging it against HEAD and, while a merge stands open, against each head it merges: a crossing standing in any parent is not new. The tree is shaped by the `format` commands of its `tagma.config.ts` as submit_work shapes it, and `formed` names the files they rewrote, whose lines and counts read that form. `paths` selects work; `whole` carries named paths intact. `violations` are the new crossings outside each rule's debt, `holders` naming the live peers a crossing's line belongs to. When the change alters an enforced key's description, that rule also measures its whole reach in the built version, with `owed` marking debt; standing findings introduced by the description alone do not make `refuses` true. `over: \"all\"` reads the reach at HEAD whole: every violation found, `owed` marking the debt. `rules` names enforced rules, or `all` (the default) for every enforced rule the change reaches, or every one over HEAD. `inspection` runs that key of `tagma.config.ts` instead — read from the version judged, so a key the session's uncommitted config adds runs over the change before it lands — over the reach of `blockId`'s region or the whole project, as enforce_rule would measure it: over the change, every violation it finds in that reach of the built version, the residue the change would leave. Over the change, `refuses` says whether submit_work would refuse it: a violation on this session's own lines, or a failed run, of a rule at gate triggered before submit_work. `over: \"staged\"` judges the tree the index of `root` holds against its HEAD, and against each head MERGE_HEAD names, exactly as a commit is judged — the rules triggered before submit_work, by the project that holds `root`, every line counted as the committer's — and answers `refuses` with the `refusal` a commit would meet; `rules`, `inspection` and the change's inputs do not apply to it. The answer is a page of violations with the total, every distinct fingerprint, the unjudged specifiers, and each rule's strictness, triggers, duration, whether the change reached it, and why it failed. A continuation runs again, and a moved HEAD or change refuses the cursor stale.",
    input: Schema.Struct({
      project: projectField,
      rules: Schema.optional(Schema.Union([Schema.Literal('all'), Schema.Array(blockRef)])).annotate({
        description: 'Enforced rules to run by name, or `all` (the default); ignored with `inspection`.',
      }),
      over: Schema.optional(Schema.Literals(CHECK_OVER)).annotate({
        description:
          '`change` (default): this session\u2019s uncommitted change against HEAD; `all`: the reach at HEAD; `staged`: what the index of `root` would commit.',
      }),
      checkout: Schema.optional(Schema.NonEmptyString.annotate(placeRole('checkout'))).annotate({
        description: 'With `change`: the registered checkout root whose selected session lines are judged.',
      }),
      root: Schema.optional(Schema.NonEmptyString.annotate(placeRole('checkout'))).annotate({
        description: 'With `staged`: an absolute path inside the checkout whose index is judged, a worktree\u2019s own among them.',
      }),
      index: Schema.optional(Schema.NonEmptyString).annotate({
        description:
          'With `staged`: the index file a commit is being made from, as git names it to a hook in `GIT_INDEX_FILE`; absent, the checkout\u2019s own.',
      }),
      inspection: Schema.optional(inspectionKey).annotate({
        description:
          'A key of `tagma.config.ts` in the version judged — over the change, HEAD with this session\u2019s uncommitted lines — to run instead of enforced rules.',
      }),
      blockId: Schema.optional(blockRef).annotate({
        description: 'With `inspection`: the block whose region is the reach — the rule about to be enforced.',
      }),
      paths: Schema.optional(Schema.Array(Schema.String.annotate(placeRole('value')))).annotate({
        description:
          'Over the change: files or directories narrowing it to that part of this session\u2019s own work; absent, everything it holds here.',
      }),
      whole: Schema.optional(Schema.Array(Schema.String.annotate(placeRole('value')))).annotate({
        description: 'Over the change: files or directories to carry intact within selected paths, peer lines included.',
      }),
      taking: Schema.optional(Schema.Array(Schema.String)).annotate({
        description:
          'Over the change: sessions whose held paths it carries beside this one\u2019s, by team name or thread id, as submit_work takes them.',
      }),
      limit: limitOf(VIOLATIONS),
      cursor: placedCursor,
    }),
    refusals: [
      'not-found',
      'deleted',
      'out-of-scope',
      'reach-empty',
      'not-enforced',
      'inspection-unknown',
      'inspection-failed',
      'no-record',
      'no-branch',
      'git-unavailable',
      'git-not-admitted',
      'root-unproven',
      'multiple-checkouts',
      'tree-mid-merge',
      'walk-cut',
      'lines-held',
      'landing-busy',
      ...SHAPE_REFUSALS,
      'bad-cursor',
      'cursor-stale',
    ],
    confirmation: (input: { readonly over?: string; readonly inspection?: unknown }) => ({
      summary:
        input.over === 'staged'
          ? 'Judge what the index would commit?'
          : input.inspection !== undefined
            ? `Run this inspection over ${input.over === 'all' ? 'HEAD' : "this session's change"}?`
            : `Run the enforced rules over ${input.over === 'all' ? 'HEAD' : "this session's change"}?`,
    }),
    confirmLabel: 'Check',
    presentation: { running: 'Checking the rules', done: 'Checked the rules' },
    subjects: () => [],
  }),

  gate_commit: operation('gate_commit', {
    approval: ASKS_NEVER,
    callers: 'any',
    waits: [],
    lifetimes: [],
    place: 'project',
    effect: 'write',
    identity: { key: 'call' },
    subject: 'none',
    answer: arms({ ok: CheckAnswer.fields }),
    doors: { http: 'perform' },
    tool: undefined,
    meaning:
      'Judge what a checkout’s index is about to commit as the gate of a `git commit` that its refusal stops, and record that refusal among the refused rules’ refusals.',
    grammar:
      'Tagma\'s `pre-commit`, `pre-merge-commit` and `prepare-commit-msg` hooks call it through `tagma check --gate` when the refusal stops the commit: always for a session\'s commit, for the operator\'s unless `TAGMA_ALLOW=1` lets it through. It judges as check_rules `over: "staged"` does and answers the same first page; each crossing of a `rule-violated` refusal is recorded with op `git_commit`, the caller, the branch and the HEAD judged against, as a refused submit_work\'s is. A continuation of the page is check_rules `over: "staged"` with the same `root` and `index` and the `next` cursor, which records nothing.',
    input: Schema.Struct({
      project: projectField,
      root: Schema.optional(Schema.NonEmptyString.annotate(placeRole('checkout'))).annotate({
        description: 'An absolute path inside the checkout whose index is judged, a worktree\u2019s own among them.',
      }),
      index: Schema.optional(Schema.NonEmptyString).annotate({
        description:
          'The index file the commit is being made from, as git names it to a hook in `GIT_INDEX_FILE`; absent, the checkout\u2019s own.',
      }),
    }),
    refusals: [],
    confirmation: () => ({ summary: 'Judge what the index would commit and record a refusal?' }),
    confirmLabel: 'Judge',
    presentation: { running: 'Judging a commit', done: 'Judged a commit' },
    subjects: () => [],
  }),

  record_commit: operation('record_commit', {
    approval: ASKS_IN_REVIEW,
    callers: 'any',
    waits: [],
    lifetimes: [],
    place: 'project',
    effect: 'write',
    identity: { key: 'call' },
    subject: 'none',
    answer: arms({ ok: { record: CommitRecord } }),
    doors: { http: 'perform' },
    tool: undefined,
    meaning:
      'Record a commit `git commit` made in a checkout of this project: what it let in past the rules triggered by submit_work is recorded as escapes held by its committer, and the rules triggered after submit_work run over it.',
    grammar:
      "Tagma's `post-commit` and `post-merge` hooks call it through `tagma check --landed` without waiting for it. The answer comes once the commit is queued, naming its holder — the calling session, or `operator` for a call no session signs; the queue then judges it against its parents — a crossing standing in any of them is not new — by the project that holds `root`, while it is HEAD or an ancestor of it, and hands each crossing outside its rule's debt to the re-measure, which records it as escaped with that holder once it still stands at HEAD. Nothing is refused, because the commit already stands.",
    input: Schema.Struct({
      root: Schema.NonEmptyString.annotate({
        ...placeRole('checkout'),
        description: 'An absolute path inside the checkout the commit was made in.',
      }),
      commit: Schema.NonEmptyString.annotate({ description: 'The commit that landed, as `git rev-parse HEAD` names it after the commit.' }),
    }),
    refusals: [],
    confirmation: (input: { readonly commit: string }) => ({ summary: `Record what ${input.commit.slice(0, 10)} let in?` }),
    confirmLabel: 'Record',
    presentation: { running: 'Recording a commit', done: 'Recorded a commit' },
    subjects: () => [],
  }),

  read_enforcement: operation('read_enforcement', {
    approval: ASKS_NEVER,
    callers: 'any',
    waits: [],
    lifetimes: [],
    place: 'project',
    effect: 'read',
    identity: 'none',
    subject: 'head',
    page: ENGINES,
    answer: arms({ ok: EnforcementReading.fields }),
    doors: { http: 'perform' },
    tool: { capability: 'graph' },
    meaning:
      "Read this project's rules as an operator reads them: every #rule, an enforced one with its inspection key, the function describing it, strictness, triggers, checker, reach, debt and its movement and newest refusal, the rest followed as text with their delivery; or one enforced rule's engine — its parameters in their shape, debt by owner, history, refusals, escapes and last change.",
    grammar:
      "Without `rule` the answer is `counts` (rules, enforced rules by strictness, debt entries) and a page of `rules`, grouped by concern, the rules followed as text last: `checker` null, `inspection` the key a switched-off rule still names, `enabled` false for one switched off, `unreadable` for an enforcement document this server does not decode. With `rule` it is that rule's `engine`, whose `revision` enforce_rule takes as `base`, and the first page of each of its lists — `debt`, `refusals` (newest first), `escaped`, and for a modules shape `units`; the checker and shapes are those `tagma.config.ts` at HEAD describes for the rule's key. `focus` names the module whose neighbourhood a modules shape answers, by default the one its newest refusal stood in. A `next` handed back as `cursor`, with the same `rule`, answers only that list's next page, and refuses `cursor-stale` once the rule's enforcement moved. A refusal is recorded for each crossing of a refused submit_work, merge_worktree, commit_checkout or `git commit` (op `git_commit`, through gate_commit); check_rules records nothing.",
    input: Schema.Struct({
      project: projectField,
      rule: Schema.optional(blockRef.annotate({ description: "The #rule whose engine to read; absent, all the project's rules." })),
      focus: Schema.optional(
        Schema.NonEmptyString.annotate({ description: 'With a modules shape: the module whose neighbourhood to answer.' }),
      ),
      limit: Schema.optional(
        Schema.Int.check(Schema.isGreaterThan(0)).annotate({
          description: 'How many rows the list being read answers; each list keeps its own default and ceiling.',
        }),
      ),
      cursor: placedCursor,
    }),
    refusals: ['bad-cursor', 'cursor-stale', 'not-found', 'deleted', 'not-enforced', 'inspection-failed', 'no-root'],
    confirmation: () => ({ summary: "Read this project's rules?" }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the rules', done: 'Read the rules' },
    subjects: () => [],
  }),
};

export const CHECK_OPERATION: EnforcementOperationId = 'check_rules';

export const RECORD_OPERATION: EnforcementOperationId = 'record_commit';

export type EnforcementOperationId = keyof typeof ENFORCEMENT_OPERATIONS;
export const ENFORCEMENT_OPERATION_IDS = Object.keys(ENFORCEMENT_OPERATIONS) as readonly EnforcementOperationId[];
