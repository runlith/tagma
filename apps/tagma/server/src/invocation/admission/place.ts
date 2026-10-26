import { Context, Effect } from 'effect';
import { isAbsolute, resolve } from 'node:path';
import { sameWitness } from '@runlith/files/witness';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import type { Operation } from '../../platform/contract/wire/operation.js';
import type { Place } from '../../platform/contract/wire/place.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Projects } from '../../projects/contract/service/registry.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { WorkingOrigins } from '../../workspace/contract/service/places.js';
import { GraphScopes, ProjectPolicy, ProjectLifecycle, RoutedGraphs } from '../../graph/contract/service/serving.js';
import { OtherGraphs } from '../../graph/serving/policy.js';
import { resolveProject } from '../../graph/serving/selector.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { callServices, onPlace, type CallFacts } from './services.js';
import { SubjectProject } from '../../platform/contract/service/place.js';
import type { Bound } from '../../platform/contract/service/body.js';
import { type DynamicOperationFailure } from '../contract/service/refusals.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { workspaceAt } from './workspace.js';
import { servedAt, unopenedGraph } from './project.js';
import type { SubjectKind } from '../../platform/contract/wire/place.js';
import { subjectFields } from '../../platform/contract/wire/subjects.js';
import { OperationCatalog } from '../contract/service/catalog.js';

const mismatch = (explicit: number, subject: number) =>
  new GateRefusal('place-mismatch', `This call names project ${explicit}, but its subject belongs to project ${subject}.`, [
    `call project ${subject} for this subject`,
    `or name a subject in project ${explicit}`,
  ]);

const selectorOf = (entry: Operation, input: unknown): string | number | undefined => {
  if (entry.place !== 'project' || typeof input !== 'object' || input === null) return undefined;
  const project = (input as { readonly project?: unknown }).project;
  return typeof project === 'string' || typeof project === 'number' ? project : undefined;
};

type Named = { readonly field: string; readonly projectId: number };

type Subject = {
  readonly projectId: number;
  readonly by: Named;
  readonly checkout: string | null;
  readonly graph: Place | null;
};

const fieldsMismatch = (first: Named, second: Named) =>
  new GateRefusal(
    'place-mismatch',
    `\`${first.field}\` belongs to project ${first.projectId}, but \`${second.field}\` belongs to project ${second.projectId}.`,
    ['split it into one call per project'],
  );

const checkoutsMismatch = (first: string, second: string) =>
  new GateRefusal('place-mismatch', `This call addresses two checkouts: ${first} and ${second}.`, ['split it into one call per checkout']);

const joined = (
  held: Subject | null,
  named: Named,
  kind: SubjectKind,
  listed: boolean,
  place: Place,
): Effect.Effect<Subject, GateRefusal<'place-mismatch'>> => {
  if (held !== null && held.projectId !== place.projectId) return Effect.fail(fieldsMismatch(held.by, named));
  const code = (kind === 'path' || kind === 'checkout' || kind === 'worktree' || kind === 'cursor') && !listed ? place.checkout : null;
  if (code !== null && held?.checkout != null && held.checkout !== code) return Effect.fail(checkoutsMismatch(held.checkout, code));
  return Effect.succeed({
    projectId: place.projectId,
    by: held?.by ?? named,
    checkout: code ?? held?.checkout ?? null,
    graph: held?.graph ?? (kind === 'block' ? place : null),
  });
};

const placeOfSubject = (subject: Subject): Place =>
  subject.checkout !== null
    ? { projectId: subject.projectId, checkout: subject.checkout, branch: null }
    : (subject.graph ?? { projectId: subject.projectId, checkout: null, branch: null });

const subjectOf = Effect.fnUntraced(function* (
  entry: Operation,
  operation: string,
  input: unknown,
  caller: Caller,
  initial: Context.Context<any>,
) {
  if (entry.place !== 'project') return null;
  const catalog = yield* OperationCatalog;
  let held: Subject | null = null;
  for (const field of subjectFields(entry.params)) {
    const owner = catalog.subjects(field.role);
    if (owner === undefined) return yield* Effect.die(new Error(`No owner resolves the subject kind ${field.role}.`));
    for (const value of new Set(field.values(input))) {
      const place = yield* Effect.provide(onPlace(owner.place(value, operation, caller)), initial);
      if (place === null) continue;
      held = yield* joined(held, { field: field.path, projectId: place.projectId }, field.role, field.listed, place);
    }
  }
  return held;
});

const sameCheckout = Effect.fnUntraced(function* (first: string, second: string | null | undefined) {
  if (second === null || second === undefined) return false;
  if (first === second) return true;
  const roots = yield* Effect.serviceOption(FileRoots);
  if (roots._tag === 'None') return false;
  const probe = (path: string) => roots.value.probe(path).pipe(Effect.catchTag('RootMissing', () => Effect.succeed(null)));
  const placed = yield* Effect.all([probe(first), probe(second)]).pipe(
    Effect.mapError((failure) => new GateRefusal('files', failure.message, ['read the checkout again'])),
  );
  return placed[0] !== null && placed[1] !== null && sameWitness(placed[0].witness, placed[1].witness);
});

export const factsAt = Effect.fn('invocation.factsAt')(function* (
  facts: CallFacts,
  place: Place,
  unopened: GateRefusal<'not-served'> | null,
  known?: ProjectRow,
) {
  const project = known ?? (yield* (yield* Projects).byId(place.projectId));
  const pool = yield* RoutedGraphs;
  if (pool === null) {
    if (place.checkout !== null)
      return yield* new GateRefusal('graph-pool', 'The call has no served graph pool for this checkout.', ['call a running server']);
    if (unopened !== null)
      return {
        ...facts,
        target: place,
        request: { ...facts.request, cwd: undefined, branch: place.branch ?? undefined },
        graphContext: undefined,
        place: null,
        served: null,
        refused: unopened,
        project: Effect.succeed({ project: { id: project.id, name: project.name } }),
        graph: Effect.fail(unopened),
        scopes: null,
      } satisfies CallFacts;
    const reach = yield* OtherGraphs;
    const there = reach === null ? null : yield* reach(place.projectId);
    const tags = there === null ? yield* Tags : Context.get(there, Tags);
    const vocabulary = yield* tags.of(place.projectId);
    return {
      ...facts,
      target: place,
      request: { ...facts.request, cwd: undefined, branch: place.branch ?? undefined },
      graphContext: there === null ? undefined : Context.omit(ProjectPolicy, ProjectLifecycle)(there),
      place: null,
      served: null,
      refused: null,
      project: Effect.succeed({ project: { id: project.id, name: project.name } }),
      graph: Effect.succeed({
        project: { id: project.id, name: project.name },
        vocabulary,
        lens: { scope: undefined, names: 'every-served-project' },
        deliveredTags: undefined,
      }),
      scopes: there === null ? facts.scopes : Context.get(there, GraphScopes),
    } satisfies CallFacts;
  }
  const { served, refused, checkout } = yield* servedAt(
    pool,
    { projectId: place.projectId, cwd: place.checkout ?? undefined, branch: place.branch ?? undefined, project },
    unopened,
  );
  if (place.checkout !== null && checkout !== null && !(yield* sameCheckout(place.checkout, checkout))) {
    return yield* new GateRefusal('place-mismatch', `The selected checkout ${place.checkout} now resolves to ${checkout}.`, [
      'start a new call for the checkout that now stands there',
    ]);
  }
  const origins = yield* WorkingOrigins;
  const root = checkout ?? place.checkout ?? project.rootPath;
  const placed = yield* workspaceAt(origins, facts.caller.actor, root);
  const graph: CallFacts['graph'] =
    served === null
      ? Effect.fail(refused!)
      : Effect.map(Context.get(served.context, Tags).of(place.projectId), (vocabulary) => ({
          project: { id: project.id, name: project.name },
          vocabulary,
          lens: { scope: undefined, names: 'every-served-project' as const },
          deliveredTags: undefined,
        })).pipe(Effect.mapError((failure) => new GateRefusal('graph-pool', failure.message, ['read the graph again'])));
  return {
    ...facts,
    request: {
      ...facts.request,
      cwd: place.checkout ?? undefined,
      branch: place.branch ?? undefined,
    },
    place: placed.place,
    target: { ...place, checkout: root },
    graphContext: undefined,
    served,
    refused,
    project: Effect.succeed({ project: { id: project.id, name: project.name } }),
    graph,
    scopes: served === null ? null : Context.get(served.context, GraphScopes),
  } satisfies CallFacts;
});

const bodyInputOf = Effect.fnUntraced(function* (entry: Operation, input: unknown, caller: Caller) {
  const catalog = yield* OperationCatalog;
  let body = input;
  for (const field of subjectFields(entry.params)) {
    const canonical = catalog.subjects(field.role)?.canonical;
    if (canonical === undefined) continue;
    const spelled = new Map<string, string>();
    for (const value of new Set(field.values(body))) {
      const found = yield* canonical(value, caller);
      if (found !== null && found !== value) spelled.set(value, found);
    }
    if (spelled.size > 0) body = field.respelled(body, (value) => spelled.get(value) ?? value);
  }
  return body;
});

export const operationFacts = Effect.fn('invocation.operationFacts')(
  function* <Input, Prepared, Answer, R, E>(
    entry: Operation,
    bound: Bound<Input, Prepared, Answer, R, E>,
    input: Input,
    facts: CallFacts,
    _context: Context.Context<any>,
  ) {
    const placed = yield* placedFacts(entry, bound, input, facts);
    const bodyInput = yield* bodyInputOf(entry, input, facts.caller);
    return bodyInput === input ? placed : { ...placed, bodyInput };
  },
  (effect, _entry, _bound, _input, _facts, context) => Effect.provide(effect, context),
);

const placedFacts = Effect.fnUntraced(function* <Input, Prepared, Answer, R, E>(
  entry: Operation,
  bound: Bound<Input, Prepared, Answer, R, E>,
  input: Input,
  facts: CallFacts,
) {
  const actor = facts.caller.actor;
  const unopened = unopenedGraph(bound.id, entry);
  if (entry.place === 'home' && actor.kind === 'thread') {
    const standing = facts.target?.projectId ?? facts.served?.projectId;
    return standing === actor.projectId
      ? facts
      : yield* factsAt(facts, { projectId: actor.projectId, checkout: null, branch: null }, unopened);
  }
  const payload = selectorOf(entry, input);
  const transport =
    facts.request.project === undefined ? undefined : (facts.target?.projectId ?? (yield* resolveProject(facts.request.project)).id);
  const named = payload === undefined ? undefined : yield* resolveProject(payload);
  const explicit = named?.id ?? transport;
  if (named !== undefined && transport !== undefined && transport !== named.id) return yield* mismatch(transport, named.id);
  let selected = facts;
  if (explicit !== undefined && explicit !== (facts.target?.projectId ?? facts.served?.projectId)) {
    selected = yield* factsAt(facts, { projectId: explicit, checkout: null, branch: facts.request.branch ?? null }, unopened, named);
  }
  if (explicit !== undefined) selected = { ...selected, request: { ...selected.request, project: String(explicit) } };
  const initial = callServices(selected);
  const fields = yield* subjectOf(entry, bound.id, input, facts.caller, initial);
  let subject: Place | null = fields === null ? null : placeOfSubject(fields);
  if (bound.place !== undefined) {
    const computed = yield* Effect.provide(
      Effect.provideService(onPlace(bound.place(input, facts.caller)), SubjectProject, fields?.projectId ?? null),
      initial,
    );
    if (computed !== null && fields !== null && computed.projectId !== fields.projectId)
      return yield* fieldsMismatch(fields.by, { field: 'the place this call computes', projectId: computed.projectId });
    if (computed !== null && (fields === null || fields.checkout === null)) subject = computed;
  }
  if (entry.subject === 'file') {
    const paths = yield* CheckoutPaths;
    const subjects = [...entry.subjects(input, undefined, facts.caller.actor), ...(bound.files?.(input, facts.caller) ?? [])];
    for (const file of subjects) {
      if (file.file !== true) continue;
      if (!isAbsolute(file.value) && selected.place === null)
        return yield* new GateRefusal('project-required', 'A relative file subject needs a workspace.', [
          'name an absolute path',
          'or call from a selected project checkout',
        ]);
      const path = resolve(selected.place?.root ?? '.', file.value);
      const located = yield* (
        entry.filePlace === 'entry' || file.entry === true ? paths.placeAcross(path) : paths.resourceAcross(path)
      ).pipe(Effect.mapError((failure) => new GateRefusal('files', failure.reason, ['read the checkout again'])));
      if (located === null) continue;
      if (subject !== null && (subject.projectId !== located.projectId || subject.checkout !== located.root)) {
        return yield* new GateRefusal('place-mismatch', 'This call addresses files in different checkouts.', [
          'split it into one call per checkout',
        ]);
      }
      subject = { projectId: located.projectId, checkout: located.root, branch: null };
    }
  }
  if (subject !== null && explicit !== undefined && explicit !== subject.projectId && entry.place !== 'fixed')
    return yield* mismatch(explicit, subject.projectId);
  if (
    subject === null ||
    (subject.projectId === (selected.target?.projectId ?? selected.served?.projectId) &&
      (subject.checkout === null || (yield* sameCheckout(subject.checkout, selected.target?.checkout ?? selected.served?.checkout))))
  )
    return selected;
  return yield* factsAt(selected, subject, unopened);
});

export const addressedThread = Effect.fnUntraced(function* (entry: Operation, input: unknown, caller: Caller) {
  const owner = (yield* OperationCatalog).subjects('thread');
  if (owner?.canonical === undefined) return null;
  const found = new Set<string>();
  for (const field of subjectFields(entry.params)) {
    if (field.role !== 'thread') continue;
    for (const value of field.values(input)) {
      const id = yield* owner.canonical(value, caller);
      if (id !== null) found.add(id);
      if (found.size > 1) return null;
    }
  }
  return found.size === 1 ? [...found][0]! : null;
});

export const placedContext = <R>(context: Context.Context<R | OperationCatalog>) =>
  Context.merge(context, Context.get(context, OperationCatalog).subjectCalls());
