<script lang="ts">
  import {
    NO_REVIEW,
    type ReviewPolicy,
    type TeamEdit,
    type TeamModel,
    type TeamModelEdit,
    type TeamModelKey,
  } from '@runlith/agent/collaboration/team';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import X from '@lucide/svelte/icons/x';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import Group from '$lib/features/settings/Group.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { byBest, rank } from '@runlith/search-text/match';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Command from '$lib/shared/ui/command/index.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import ReviewForm from './ReviewForm.svelte';
  import RowLabel from './RowLabel.svelte';
  import { TeamRepo } from './TeamRepo.js';
  import WorkPicker from './WorkPicker.svelte';
  import { editsRow, providerOn, rowKey, sameRow, withEdit, withoutRow } from './edits.js';
  import { rowName } from './words.js';

  let { catalog, scope }: SectionProps = $props();

  const MODELS = 'agent.models';
  const REVIEW = 'agent.review';
  const RATINGS = [
    { field: 'open', label: 'Open', top: 10 },
    { field: 'depth', label: 'Depth', top: 10 },
    { field: 'taste', label: 'Taste', top: 10 },
    { field: 'ui', label: 'UI', top: 10 },
    { field: 'spend', label: 'Spend', top: 5 },
  ] as const;
  type RatingField = (typeof RATINGS)[number]['field'];
  type RowFields = Partial<Omit<TeamModelEdit, keyof TeamModelKey>>;

  const teams = TeamRepo.use();
  const providers = ProviderCatalog.use();
  const accounts = UsageAccounts.use();

  const query = $derived(teams.read.key({ projectId: catalog.projectId, threadId: null, layer: scope }));
  const read = $derived(query.data);
  const rows = $derived(read?.team.models ?? []);
  const off = $derived(read?.team.off ?? []);
  const groups = $derived(
    [...new Set(rows.map((row) => row.provider))].map((provider) => ({
      provider,
      on: providerOn(edits, provider, !off.includes(provider)),
      rows: rows.filter((row) => row.provider === provider),
    })),
  );

  const modelsEntry = $derived(catalog.entriesOf('agent').find((entry) => entry.id === MODELS));
  const reviewEntry = $derived(catalog.entriesOf('agent').find((entry) => entry.id === REVIEW));
  const own = $derived(
    (modelsEntry === undefined ? undefined : catalog.answerOf(modelsEntry, scope).own) as readonly TeamEdit[] | undefined,
  );
  const edits = $derived(own ?? []);
  const below = $derived(
    scope === 'project' && modelsEntry !== undefined ? ((catalog.answerOf(modelsEntry, 'user').own ?? []) as readonly TeamEdit[]) : [],
  );
  const reviewAnswer = $derived(reviewEntry === undefined ? undefined : catalog.answerOf(reviewEntry, scope));
  const policy = $derived(((reviewAnswer?.own ?? reviewAnswer?.inherited) as ReviewPolicy | undefined) ?? NO_REVIEW);

  const outcome = (key: string) => {
    const said = catalog.outcomes[key];
    return said?.kind === 'refused' ? said.reason : null;
  };

  let picking = $state(false);
  let search = $state('');

  const connected = $derived(
    providers.served.providers
      .map((provider) => provider.id)
      .filter((provider) => accounts.signing(provider).some((row) => row.problem === null)),
  );
  const offered = $derived(
    connected.flatMap((provider) =>
      providers.models.registered(provider)
        ? providers.models.modelsFor(provider, 'text').flatMap((model) =>
            (model.reasoningOptions.length === 0 ? [null] : model.reasoningOptions.map((rung) => rung.id)).map((reasoning) => ({
              provider,
              model: model.id,
              reasoning,
            })),
          )
        : [],
    ),
  );
  const addable = $derived.by(() => {
    const ranked = rank(
      offered.filter((key) => !rows.some((row) => sameRow(row, key))),
      search,
      (key) => {
        const named = rowName(providers.models, key);
        return { name: named.rung === null ? named.label : `${named.label} ${named.rung}`, names: [key.model] };
      },
    );
    return byBest(connected, ranked, (provider, key) => key.provider === provider)
      .map((provider) => ({ provider, keys: ranked.filter(({ item }) => item.provider === provider).map(({ item }) => item) }))
      .filter((group) => group.keys.length > 0);
  });

  async function write(key: string, value?: unknown): Promise<void> {
    await catalog.write({ scope, key, value });
    await query.refresh();
  }

  const keyOf = (row: TeamModelKey): TeamModelKey => ({ provider: row.provider, model: row.model, reasoning: row.reasoning });

  function change(row: TeamModelKey, fields: RowFields): void {
    void write(MODELS, withEdit(edits, { ...keyOf(row), ...fields }));
  }

  function rate(row: TeamModelKey, field: RatingField, value: number): void {
    const fields: Partial<Record<RatingField, number>> = {};
    fields[field] = value;
    change(row, fields);
  }

  const standsBelow = (row: TeamModel): boolean => row.shipped || editsRow(below, row);

  function remove(row: TeamModel): void {
    const kept = withoutRow(edits, row);
    void write(MODELS, standsBelow(row) ? [...kept, { ...keyOf(row), removed: true }] : kept);
  }

  function add(key: TeamModelKey): void {
    picking = false;
    const buried = edits.some((one) => 'model' in one && sameRow(one, key) && one.removed === true);
    void write(MODELS, withEdit(buried ? withoutRow(edits, key) : edits, { ...key, on: true }));
  }

  function note(row: TeamModel, typed: string): void {
    const text = typed.trim();
    if (text === (row.note ?? '')) return;
    change(row, { note: text === '' ? null : text });
  }

  const CELL = 'px-1 py-1 align-middle';
  const SELECT = 'rounded-md border border-vein bg-background px-1 py-0.5 font-mono text-meta tabular-nums disabled:opacity-50';
</script>

<Group title="Models for sub-agents">
  {#snippet act()}
    {#if own !== undefined}
      <Button variant="ghost" size="xs" disabled={catalog.busyKey === MODELS} onclick={() => void write(MODELS)}>Reset to default</Button>
    {/if}
  {/snippet}
  <div class="grid gap-2" data-setting={MODELS}>
    <p class="text-small text-muted-foreground">
      Agents pick a child’s model from the rows switched on; none is on until you choose it. Rate 1–10 how much it decides itself (open),
      how it holds on hard problems (depth), its code taste and the interface it makes (ui); spend 1–5. Rows show while their provider has a
      connected account.
    </p>
    <div class="overflow-x-auto">
      <table class="w-full text-small">
        <thead class="text-left text-meta text-muted-foreground">
          <tr>
            <th class={CELL} title="Agents may start children on it">On</th>
            <th class={CELL}>Model</th>
            {#each RATINGS as rating (rating.field)}<th class={CELL}>{rating.label}</th>{/each}
            <th class={CELL}>Only</th>
            <th class={CELL}>Not</th>
            <th class={CELL}>Note</th>
            <th class={CELL} title="Started only on the operator’s word">Yours only</th>
            <th class={CELL}></th>
          </tr>
        </thead>
        <tbody>
          {#each groups as group (group.provider)}
            <tr class="border-t border-vein">
              <td class="px-1 pt-3 pb-1 text-center">
                <input
                  type="checkbox"
                  aria-label={`All of ${providers.modeName(group.provider)}`}
                  title="Off keeps every row of this provider out, whatever its own On"
                  checked={group.on}
                  disabled={catalog.busyKey === MODELS}
                  onchange={(event) => void write(MODELS, withEdit(edits, { provider: group.provider, on: event.currentTarget.checked }))}
                />
              </td>
              <td class="px-1 pt-3 pb-1 text-small font-medium text-muted-foreground" colspan="11">{providers.modeName(group.provider)}</td>
            </tr>
            {#each group.rows as row (rowKey(row))}
              {@const name = rowName(providers.models, row)}
              {@const busy = catalog.busyKey === MODELS}
              <tr class={['border-t border-vein', !group.on && 'text-muted-foreground']} data-team-matrix-row={rowKey(row)}>
                <td class={[CELL, 'text-center']}>
                  <input
                    type="checkbox"
                    aria-label={`On — ${name.label}`}
                    checked={row.on}
                    disabled={busy}
                    onchange={(event) => change(row, { on: event.currentTarget.checked })}
                  />
                </td>
                <td class={[CELL, 'whitespace-nowrap']}>
                  {name.label}{#if name.rung !== null}<span class="text-muted-foreground">{` · ${name.rung}`}</span>{/if}
                </td>
                {#each RATINGS as rating (rating.field)}
                  <td class={CELL}>
                    <select
                      class={SELECT}
                      aria-label={`${rating.label} — ${name.label}`}
                      value={row[rating.field]}
                      disabled={busy}
                      onchange={(event) => rate(row, rating.field, Number(event.currentTarget.value))}
                    >
                      {#each Array.from({ length: rating.top }, (_, at) => at + 1) as step (step)}<option value={step}>{step}</option
                        >{/each}
                    </select>
                  </td>
                {/each}
                <td class={CELL}
                  ><WorkPicker
                    label={`Only — ${name.label}`}
                    value={row.only}
                    disabled={busy}
                    onchange={(only) => change(row, { only })}
                  /></td
                >
                <td class={CELL}
                  ><WorkPicker label={`Not — ${name.label}`} value={row.not} disabled={busy} onchange={(not) => change(row, { not })} /></td
                >
                <td class={CELL}>
                  <input
                    class="w-36 rounded-md border border-vein bg-background px-1.5 py-0.5 text-small disabled:opacity-50"
                    type="text"
                    placeholder="up to six words"
                    aria-label={`Note — ${name.label}`}
                    value={row.note ?? ''}
                    disabled={busy}
                    onchange={(event) => note(row, event.currentTarget.value)}
                  />
                </td>
                <td class={[CELL, 'text-center']}>
                  <input
                    type="checkbox"
                    aria-label={`Only on your word — ${name.label}`}
                    checked={row.operatorOnly}
                    disabled={busy}
                    onchange={(event) => change(row, { operatorOnly: event.currentTarget.checked })}
                  />
                </td>
                <td class={[CELL, 'whitespace-nowrap text-right']}>
                  {#if editsRow(edits, row) && standsBelow(row)}
                    <button
                      type="button"
                      class="inline-grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
                      aria-label={`Reset ${name.label} to default`}
                      title="Reset to default"
                      disabled={busy}
                      onclick={() => void write(MODELS, withoutRow(edits, row))}
                    >
                      <RotateCcw class="size-3.5" />
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="inline-grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
                    aria-label={`Remove ${name.label}`}
                    title="Remove"
                    disabled={busy}
                    onclick={() => remove(row)}
                  >
                    <X class="size-3.5" />
                  </button>
                </td>
              </tr>
            {/each}
          {:else}
            <tr><td class="py-3 text-muted-foreground" colspan="12">No rows: connect a provider or add a model.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if outcome(MODELS) !== null}<p class="text-small text-destructive">{outcome(MODELS)}</p>{/if}
    <div>
      <Popover.Root
        bind:open={picking}
        onOpenChange={(next) => {
          if (next) search = '';
        }}
      >
        <Popover.Trigger
          class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-ui transition-colors hover:bg-hover disabled:opacity-50"
          disabled={catalog.busyKey === MODELS}
        >
          <Plus class="size-3.5" /> Add
        </Popover.Trigger>
        <Popover.Content align="start" class="w-72 p-0">
          <Command.Root>
            <Command.Input bind:value={search} placeholder="Search available models…" />
            <Command.List class="max-h-72">
              {#if addable.length === 0}
                <Command.Empty>Nothing to add.</Command.Empty>
              {/if}
              {#each addable as group (group.provider)}
                <Command.Group heading={providers.modeName(group.provider)}>
                  {#each group.keys as key (rowKey(key))}
                    <Command.Item class="text-small" value={rowKey(key)} onSelect={() => add(key)}>
                      <RowLabel row={key} />
                    </Command.Item>
                  {/each}
                </Command.Group>
              {/each}
            </Command.List>
          </Command.Root>
        </Popover.Content>
      </Popover.Root>
    </div>
  </div>
</Group>

<Group title="Who reviews sub-agents’ work">
  {#snippet act()}
    {#if reviewAnswer?.own !== undefined}
      <Button variant="ghost" size="xs" disabled={catalog.busyKey === REVIEW} onclick={() => void write(REVIEW)}>Reset to default</Button>
    {/if}
  {/snippet}
  <div class="grid max-w-80 gap-1" data-setting={REVIEW}>
    <ReviewForm {policy} {rows} disabled={catalog.busyKey === REVIEW} onchange={(next) => void write(REVIEW, next)} />
    {#if outcome(REVIEW) !== null}<p class="text-small text-destructive">{outcome(REVIEW)}</p>{/if}
  </div>
</Group>
