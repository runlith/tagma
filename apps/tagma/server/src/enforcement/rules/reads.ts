import { keyOrder, page, type PageKey, type PageQuestion, pageRows, pastKey, readCursor } from '@runlith/paging';
import { BUILTINS, type BuiltinId, languagesOf, packOf, type PackId } from '@tagma/inspection/builtins';
import { signatureOf } from '@tagma/inspection/signature';
import { Effect, Schema } from 'effect';
import { CONFIG_FILE, type Descriptor, type LinterInspection, type ProgramInspection } from '../../config/contract/wire/config.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { measuredRoot } from '../../graph/contract/service/serving.js';
import { blockName } from '../../graph/contract/wire/references.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { cursorRefusal, GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Projects } from '../../projects/contract/service/registry.js';
import type { FormRow, InspectionForm, KeyNaming } from '../contract/wire/enforcement.js';
import { INSPECTIONS } from '../contract/wire/pages.js';
import { Inspections } from '../workers/inspectionLanes.js';
import { configAt } from './descriptions.js';
import { FORMS, type Form, formNamed, formOf } from './forms.js';
import { headOf } from './measure.js';
import { enforcedStatutes, type Statute, switchedOffStatutes } from './reach.js';

const PROGRAM_SUMMARY =
  'A `defineProgram` module of this repository judges both sides of the change; Tagma runs it with its own Bun, and it loads what it needs from the project.';

const COMMAND_SUMMARY =
  'Any command printing SARIF 2.1, one key per rule through `.rule(id)`, or `{ findings }`, which is the inspection itself.';

const linterSummary = (tool: string): string =>
  tool === 'command' ? COMMAND_SUMMARY : `The rules of ${tool}: the tool is described once, and each rule is a key through \`.rule(id)\`.`;

const summaryOf = (form: Form): string =>
  form.kind === 'builtin' ? BUILTINS[form.builtin].summary : form.kind === 'program' ? PROGRAM_SUMMARY : linterSummary(form.tool);

const rowOf = (form: Form): FormRow => ({
  name: form.name,
  summary: summaryOf(form),
  concern: form.kind === 'builtin' ? BUILTINS[form.builtin].concern : null,
  door: form.door,
});

export const formRows = (used: readonly PackId[]): readonly FormRow[] => {
  const present = new Set(used);
  return FORMS.filter((form) => form.kind !== 'builtin' || present.has(packOf(form.builtin))).map(rowOf);
};

const builtinForm = (id: BuiltinId, form: Form | undefined): InspectionForm => ({
  name: form?.name ?? id,
  summary: BUILTINS[id].summary,
  concern: BUILTINS[id].concern,
  door: form?.door ?? null,
  builtin: id,
  pack: packOf(id),
  languages: languagesOf(id),
  signature: signatureOf(BUILTINS[id].params),
  unit: BUILTINS[id].unit,
  reach: BUILTINS[id].reach,
  unblock: BUILTINS[id].unblock,
});

const callOf = (form: Form): Effect.Effect<string> =>
  Effect.flatMap(
    Effect.promise(() => import('./signatures.js')),
    ({ SIGNATURES }) => {
      const signature = SIGNATURES[form.name];
      return signature === undefined
        ? Effect.die(new Error(`The rules SDK emitted no signature for ${form.name}`))
        : Effect.succeed(signature);
    },
  );

const PROGRAM_UNIT = 'each fingerprint the program returns, after the key';

const LINTER_UNIT = "file: the key and the path, the count of the rule's results its value";

export const builtinAnswer = (id: BuiltinId, limitations: boolean): InspectionForm => {
  const answer = builtinForm(id, undefined);
  return limitations ? { ...answer, limitations: BUILTINS[id].limitations } : answer;
};

export const formAnswer = Effect.fnUntraced(function* (form: Form, limitations: boolean) {
  const signature = yield* callOf(form);
  if (form.kind === 'builtin') {
    const answer = { ...builtinForm(form.builtin, form), signature };
    return limitations ? { ...answer, limitations: BUILTINS[form.builtin].limitations } : answer;
  }
  return {
    ...rowOf(form),
    builtin: null,
    pack: null,
    languages: [],
    signature,
    unit: form.kind === 'program' ? PROGRAM_UNIT : LINTER_UNIT,
    reach: null,
    unblock: [],
  } satisfies InspectionForm;
});

export const isBuiltinId = (name: string): name is BuiltinId => Object.hasOwn(BUILTINS, name);

export const descriptionOf = Effect.fn('enforcement.descriptionOf')(function* (descriptor: Descriptor) {
  if (!('builtin' in descriptor)) return JSON.stringify(descriptor);
  const params = BUILTINS[descriptor.builtin].params as Schema.Codec<unknown, unknown>;
  const encoded = yield* Schema.encodeUnknownEffect(params)(descriptor.params).pipe(Effect.orDie);
  return JSON.stringify({ builtin: descriptor.builtin, params: encoded });
});

const rulesNaming = Effect.fn('enforcement.rulesNaming')(function* (projectId: number, key: string) {
  const naming =
    (enabled: boolean) =>
    (one: Statute): KeyNaming[] =>
      one.document !== null && one.document.inspection === key
        ? [{ rule: blockName(one.rule.uuid), title: one.rule.title, strictness: one.document.strictness, enabled }]
        : [];
  return [...(yield* enforcedStatutes(projectId)).flatMap(naming(true)), ...(yield* switchedOffStatutes(projectId)).flatMap(naming(false))];
});

const LISTED = 'read_inspections without `name` or `key` lists the functions';

const keyAnswer = Effect.fn('enforcement.keyAnswer')(function* (
  projectId: number,
  actor: TerminalActor,
  key: string,
  limitations: boolean,
) {
  const root = yield* measuredRoot(yield* (yield* Projects).byId(projectId));
  const tree = yield* headOf(root);
  const config = yield* configAt({ projectId, actor, root, tree });
  const descriptor = config?.inspections.get(key);
  if (descriptor === undefined)
    return yield* new GateRefusal(
      'not-found',
      `${config === null ? `HEAD carries no ${CONFIG_FILE}` : `${CONFIG_FILE} at HEAD declares no inspection ${key}`}`,
      [`read_config lists the keys ${CONFIG_FILE} declares at HEAD`, LISTED],
    );
  const form =
    'builtin' in descriptor
      ? builtinAnswer(descriptor.builtin, limitations)
      : yield* formAnswer(yield* declaredForm(descriptor), limitations);
  return { form, key: { key, description: yield* descriptionOf(descriptor), rules: yield* rulesNaming(projectId, key) } };
});

const declaredForm = (descriptor: ProgramInspection | LinterInspection) => {
  const form = formOf(descriptor);
  return form === undefined
    ? Effect.die(`@runlith/tagma/rules describes no function for ${JSON.stringify(descriptor)}`)
    : Effect.succeed(form);
};

const nameAnswer = (name: string, limitations: boolean) => {
  const form = formNamed(name);
  if (form !== undefined) return Effect.map(formAnswer(form, limitations), (answer) => ({ form: answer }));
  if (isBuiltinId(name)) return Effect.succeed({ form: builtinAnswer(name, limitations) });
  return Effect.fail(new GateRefusal('not-found', `${name} is neither a function of @runlith/tagma/rules nor a builtin id`, [LISTED]));
};

const rowKey = (row: FormRow): PageKey => [row.name];

const listAnswer = Effect.fn('enforcement.inspectionForms')(function* (
  projectId: number,
  asked: number | undefined,
  cursor: string | undefined,
) {
  const question: PageQuestion = { operation: 'read_inspections', selection: { projectId }, order: INSPECTIONS.order };
  const continued = cursor === undefined ? undefined : readCursor(cursor, question);
  if (continued !== undefined && 'refused' in continued) return yield* cursorRefusal(continued.refused);
  const root = yield* measuredRoot(yield* (yield* Projects).byId(projectId));
  const used = yield* (yield* Inspections)
    .packs({ root, commit: yield* headOf(root) })
    .pipe(
      Effect.mapError(
        (failure) =>
          new GateRefusal('inspection-failed', `the project packs at HEAD could not be read (${failure.cause}): ${failure.reason}`, [
            'read_inspections again after the checkout and its package manifests can be read',
          ]),
      ),
    );
  const rows = formRows(used).toSorted((left, right) => keyOrder(['asc'])(rowKey(left), rowKey(right)));
  const cut = page({
    rows: continued === undefined ? rows : pastKey(rows, rowKey, ['asc'], continued.at),
    asked: pageRows(asked, INSPECTIONS, ceilingOf(INSPECTIONS)),
    keyOf: rowKey,
    question,
    total: rows.length,
  });
  return { rows: cut.rows, shown: cut.shown, total: rows.length, next: cut.next };
});

export type InspectionsAsk = {
  readonly name?: string;
  readonly key?: string;
  readonly limitations?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
};

export const inspectionsAnswer = (ask: InspectionsAsk, projectId: number, actor: TerminalActor) => {
  const limitations = ask.limitations === true;
  if (ask.name !== undefined && ask.key !== undefined)
    return Effect.fail(
      new GateRefusal('field-invalid', '`name` and `key` were both given; a reading answers one of them', [
        'pass `name` for a function or builtin, or `key` for a key of tagma.config.ts',
      ]),
    );
  if (ask.key !== undefined) return keyAnswer(projectId, actor, ask.key, limitations);
  if (ask.name !== undefined) return nameAnswer(ask.name, limitations);
  return listAnswer(projectId, ask.limit, ask.cursor);
};
