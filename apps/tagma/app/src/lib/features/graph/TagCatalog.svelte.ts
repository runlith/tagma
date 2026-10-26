import type { AmendmentOp } from '@tagma/server/graph/contract/wire/batch';
import type { BlockQuery, ViewLayout } from '@tagma/server/graph/contract/wire/query';
import { VIEW_LAYOUT, VIEW_QUERY } from '@tagma/server/graph/contract/wire/query';
import { rests, standsInOutline } from '@tagma/server/graph/contract/wire/standing';
import {
  type StatusPhase,
  type Tagged,
  activeStatuses,
  endingStatus,
  initialStatus,
  statusTargets,
  statusWords,
  terminalStatuses,
} from '@tagma/server/graph/contract/wire/tags/roles';
import type { Vocabulary } from '@tagma/server/graph/contract/wire/tags/table';
import type { TagReading } from '@tagma/server/graph/contract/wire/tags/reading';
import { ServedTags } from '@tagma/server/graph/contract/wire/tags/served';
import type { ContractId } from '@tagma/server/graph/contract/wire/tags/behaviour';
import { moveOwners, type NodeActions } from '@tagma/server/graph/contract/wire/tags/actions';
import { LIFECYCLE, lifecycleOf } from '@tagma/server/graph/contract/wire/tags/lifecycle';
import { AMENDMENT, amendmentOf } from '@tagma/server/graph/contract/wire/tags/amendment';
import { OBSERVATION } from '@tagma/server/graph/contract/wire/tags/observation';
import { WORK } from '@tagma/server/graph/contract/wire/tags/work';
import { REFLECTION, reflectionOf } from '@tagma/server/graph/contract/wire/tags/reflection';
import { type Delivery, deliveryOf, isEnabled, statedDelivery } from '@tagma/server/graph/contract/wire/tags/law';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { TagsRepo } from './TagsRepo.js';
import { type RestingState, type StateMark, type StatusAction, isStatusOp, statusColor, statusLabel } from './status.js';

export type MarkedRow = Tagged & {
  readonly actions: NodeActions;
  readonly superseded?: boolean;
  readonly building?: boolean;
  readonly answered?: boolean;
};

const TAG_PLURAL: Record<string, string> = {
  module: 'Modules',
  spec: 'Specs',
  task: 'Tasks',
  rule: 'Rules',
  idea: 'Ideas',
  proposal: 'Proposals',
  reflection: 'Reflections',
  research: 'Research',
  view: 'Views',
  tag: 'Tags',
  note: 'Notes',
  person: 'People',
  meeting: 'Meetings',
  recipe: 'Recipes',
};

const NOTHING_SERVED: Vocabulary = {
  catalogs: [],
  installed: [],
  findings: [],
  tags: [],
  unreadable: [],
  actions: {},
  fieldNames: {},
  forms: {},
  laws: {},
  revision: { format: 2, revision: '' },
};

export class TagCatalog extends Service<TagCatalog>()('TagCatalog', { tier: 'app', eager: true }) {
  static *make() {
    const catalog = new TagCatalog(yield* TagsRepo, yield* Workspace, yield* Scope, yield* Failure);
    catalog.follow();
    return catalog;
  }

  table = $state<TagReading>(new ServedTags(NOTHING_SERVED));
  findings = $state<Vocabulary['findings']>([]);

  served = $state(false);
  fetching = $state(false);
  error = $state<unknown>(null);

  private generation = 0;
  private projectId: number | null = null;

  constructor(
    private readonly repo: ReturnType<typeof TagsRepo.use>,
    private readonly workspace: Workspace,
    private readonly scope: Scope,
    private readonly failure: Failure,
  ) {
    super();
  }

  private follow(): void {
    $effect(() => {
      const projectId = this.workspace.contextId;
      untrack(() => void this.read(projectId));
    });
  }

  async read(projectId: number | null, refresh = false): Promise<void> {
    const generation = ++this.generation;
    if (projectId !== this.projectId) {
      this.table = new ServedTags(NOTHING_SERVED);
      this.findings = [];
      this.served = false;
    }
    this.projectId = projectId;
    this.fetching = projectId !== null;
    this.error = null;
    if (projectId === null) return;
    try {
      const answer = await this.repo.of.key(projectId).loadOrThrow(refresh ? { refresh: true } : undefined);
      if (answer === undefined || this.scope.signal.aborted || generation !== this.generation) return;
      this.table = new ServedTags(answer);
      this.findings = answer.findings;
      this.served = true;
    } catch (error) {
      if (this.scope.signal.aborted || generation !== this.generation) return;
      this.served = false;
      this.error = error;
      this.failure.report(error);
    } finally {
      if (generation === this.generation) this.fetching = false;
    }
  }

  retry(): Promise<void> {
    return this.read(this.workspace.contextProject?.id ?? null, true);
  }

  resync(projectId: number): void {
    if (this.workspace.contextProject?.id !== projectId) return;
    void this.read(projectId, true);
  }

  tagOf(row: Tagged): string | null {
    return this.table.tagOf(row)?.id ?? row.tags[0] ?? null;
  }

  word(id: string | null): string {
    return id ?? 'note';
  }

  label(id: string): string {
    return TAG_PLURAL[id] ?? `#${id}`;
  }

  supports(row: Tagged, contract: ContractId): boolean {
    return this.table.supports(row, contract);
  }

  enforced(row: Tagged & { readonly fields: Readonly<Record<string, unknown>> }): boolean {
    const field = this.table.lawProjection(row)?.enforcement?.field;
    return field !== undefined && row.fields[field] !== undefined;
  }

  standsAt(row: Tagged, contract: ContractId, phase: StatusPhase): boolean {
    return this.table.standsAt(row, contract, phase);
  }

  standsInOutline(row: MarkedRow): boolean {
    return this.served && row.actions.revision === this.table.revision().revision && standsInOutline(this.table, row);
  }

  showsInOutline(row: MarkedRow, hidden: ReadonlySet<RestingState>): boolean {
    if (!this.standsInOutline(row)) return false;
    const resting = hidden.size === 0 ? null : this.restingState(row);
    return resting === null || !hidden.has(resting);
  }

  statusOf(row: Tagged): string | null {
    return this.table.statusOf(row);
  }

  holderOf(row: Tagged): number | null {
    return this.table.holderOf(row);
  }

  bearsLaw(row: Tagged): boolean {
    return this.table.lawProjection(row) !== null;
  }

  get workTag(): string | null {
    return this.declared.find((id) => this.createsFromTitle(id) && this.table.supports({ tags: [id] }, WORK)) ?? null;
  }

  get lawTag(): string | null {
    return this.declared.find((id) => this.createsFromTitle(id) && this.table.lawProjection({ tags: [id] }) !== null) ?? null;
  }

  switchedOff(row: Tagged): boolean {
    const law = this.table.lawProjection(row);
    return law !== null && !isEnabled(law, row);
  }

  deliveredBy(row: Tagged): { readonly stated: Delivery | null; readonly settable: boolean } {
    const law = this.table.lawProjection(row);
    return { stated: statedDelivery(law, row), settable: law?.delivery != null };
  }

  deliveryOf(row: Tagged, sourced: boolean): Delivery | null {
    const law = this.table.lawProjection(row);
    return law === null ? null : deliveryOf(law, row, sourced);
  }

  get declared(): readonly string[] {
    return this.table.declaredTags();
  }

  createsFromTitle(id: string): boolean {
    const tag = this.table.tagById(id);
    return tag !== null && !tag.gates.some((gate) => gate.gate === 'required' || gate.gate === 'source-required');
  }

  get titleOnly(): readonly string[] {
    return this.declared.filter((id) => this.createsFromTitle(id));
  }

  get statuses(): readonly string[] {
    return this.table.statuses();
  }

  isTerminal(row: Tagged): boolean {
    return this.table.isTerminal(row);
  }

  underway(row: Tagged): boolean {
    const tag = this.table.bindingTag(row, LIFECYCLE);
    const status = this.statusOf(row);
    return tag !== null && status !== null && activeStatuses(tag).includes(status);
  }

  verdictsOf(row: Tagged): readonly string[] {
    const tag = this.table.bindingTag(row, AMENDMENT);
    return tag === null ? [] : terminalStatuses(tag);
  }

  statusVar(row: MarkedRow): string {
    if (row.superseded) return 'var(--status-superseded)';
    return statusColor(this.statusOf(row));
  }

  marks(row: MarkedRow): StateMark[] {
    const marks: StateMark[] = [];
    const status = this.statusOf(row);
    if (status !== null && !row.superseded) marks.push({ label: statusLabel(status), tone: 'status' });
    if (row.building && !row.superseded) marks.push({ label: 'in work', tone: 'building' });
    if (row.superseded) marks.push({ label: 'superseded', tone: 'muted' });
    if (row.answered) marks.push({ label: 'answered', tone: 'muted' });
    if (this.switchedOff(row)) marks.push({ label: 'off', tone: 'muted' });
    return marks;
  }

  rowMarks(row: MarkedRow): StateMark[] {
    const tag = this.table.bindingTag(row, LIFECYCLE);
    const born = tag === null ? null : initialStatus(tag);
    const status = this.statusOf(row);
    const quiet = born !== null && status === born;
    return this.marks(row).filter((mark) => !(quiet && mark.tone === 'status'));
  }

  isResting(row: MarkedRow): boolean {
    return rests(this.table, row);
  }

  restingState(row: MarkedRow): RestingState | null {
    if (row.superseded) return 'superseded';
    if (row.answered && this.table.supports(row, OBSERVATION)) return 'answered';
    const tag = this.table.bindingTag(row, LIFECYCLE);
    const status = this.statusOf(row);
    if (tag === null || status === null || !this.table.isTerminal(row)) return null;
    if (status === endingStatus(tag, 'done')) return 'done';
    return status === endingStatus(tag, 'closed') ? 'closed' : null;
  }

  actions(row: MarkedRow): StatusAction[] {
    const actions: StatusAction[] = [];
    if (!this.served || this.fetching || row.actions.revision !== this.table.revision().revision) return actions;
    const tag = this.table.bindingTag(row, LIFECYCLE);
    const field = tag === null ? undefined : lifecycleOf(tag)?.field;
    const status = this.statusOf(row);
    if (tag === null || field === undefined || status === null) return actions;
    const owned = row.actions;
    const reopens = this.table.isTerminal(row) ? initialStatus(tag) : null;
    for (const to of statusTargets(tag, status)) {
      const moves = moveOwners(owned, field, status, to);
      if (moves.length === 0) {
        actions.push({ label: to === reopens ? 'Reopen' : `Move to ${statusLabel(to)}`, to, op: null });
        continue;
      }
      for (const { op, label } of moves) {
        if (isStatusOp(op)) actions.push({ label: label ?? `Move to ${statusLabel(to)}`, to, op });
      }
    }
    return actions;
  }

  statusWordsOf(id: string): readonly string[] {
    const tag = this.table.tagById(id);
    return tag === null ? [] : statusWords(tag);
  }

  bornAt(id: string): string | null {
    const tag = this.table.tagById(id);
    return tag === null ? null : initialStatus(tag);
  }

  binds(id: string, contract: ContractId): boolean {
    return this.table.tagById(id)?.contracts?.[contract] !== undefined;
  }

  readingOf(row: Tagged): { readonly name: string; readonly ref: string } | null {
    const field = this.table
      .tagsOf(row)
      .flatMap((tag) => Object.entries(tag.fields))
      .find(([, type]) => typeof type === 'object' && type.type === 'schema' && type.name === 'researchSource')?.[0];
    const source = field === undefined ? undefined : row.fields[field];
    if (typeof source !== 'object' || source === null) return null;
    const { name, ref } = source as { name?: unknown; ref?: unknown };
    return typeof name === 'string' && typeof ref === 'string' ? { name, ref } : null;
  }

  factsOf(row: Tagged): { readonly command: string; readonly expected: string; readonly actual: string } | null {
    const tag = this.table.bindingTag(row, REFLECTION);
    const slots = tag === null ? null : reflectionOf(tag);
    if (slots === null) return null;
    const [command, expected, actual] = [row.fields[slots.command], row.fields[slots.expected], row.fields[slots.actual]];
    return typeof command === 'string' && typeof expected === 'string' && typeof actual === 'string' ? { command, expected, actual } : null;
  }

  opsOf(row: Tagged): readonly AmendmentOp[] {
    const tag = this.table.bindingTag(row, AMENDMENT);
    const name = tag === null ? undefined : amendmentOf(tag)?.ops;
    const ops = name === undefined ? undefined : row.fields[name];
    return Array.isArray(ops) ? (ops as readonly AmendmentOp[]) : [];
  }

  queryOf(row: Tagged): BlockQuery | null {
    const query = row.fields[VIEW_QUERY];
    return typeof query === 'object' && query !== null ? (query as BlockQuery) : null;
  }

  layoutOf(row: Tagged): ViewLayout | null {
    const layout = row.fields[VIEW_LAYOUT];
    return typeof layout === 'object' && layout !== null ? (layout as ViewLayout) : null;
  }
}
