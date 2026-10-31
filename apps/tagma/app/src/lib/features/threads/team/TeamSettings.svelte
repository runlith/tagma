<script lang="ts">
  import {
    listedModels,
    NO_REVIEW,
    type ReviewPolicy,
    type TeamEdit,
    type TeamModel,
    type TeamModelKey,
  } from '@runlith/agent/collaboration/team';
  import Plus from '@lucide/svelte/icons/plus';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import Group from '$lib/features/settings/Group.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { byBest, rank } from '@runlith/search-text/match';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Command from '$lib/shared/ui/command/index.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import ListRow from './ListRow.svelte';
  import ModelCard from './ModelCard.svelte';
  import ProviderHeading from './ProviderHeading.svelte';
  import ReviewForm from './ReviewForm.svelte';
  import RowLabel from './RowLabel.svelte';
  import { TeamRepo } from './TeamRepo.js';
  import Usage from './Usage.svelte';
  import {
    editsRow,
    providerOn,
    ratingEdited,
    rowEdit,
    rowKey,
    type RowCheck,
    type RowField,
    type RowFields,
    sameRow,
    withEdit,
    withoutFields,
    withoutRow,
  } from './edits.js';
  import { AXES, modelLines, rowName } from './words.js';

  let { catalog, scope }: SectionProps = $props();

  const MODELS = 'agent.models';
  const REVIEW = 'agent.review';

  const teams = TeamRepo.use();
  const providers = ProviderCatalog.use();
  const accounts = UsageAccounts.use();

  const query = $derived(teams.read.key({ projectId: catalog.projectId, threadId: null, layer: scope }));
  const read = $derived(query.data);
  const rows = $derived(read?.team.models ?? []);
  const off = $derived(read?.team.off ?? []);
  const listed = $derived(read === undefined ? [] : listedModels(read.team));

  const modelsEntry = $derived(catalog.entries.find((entry) => entry.id === MODELS));
  const reviewEntry = $derived(catalog.entries.find((entry) => entry.id === REVIEW));
  const own = $derived(
    (modelsEntry === undefined ? undefined : catalog.answerOf(modelsEntry, scope).own) as readonly TeamEdit[] | undefined,
  );
  const edits = $derived(own ?? []);
  const below = $derived(
    scope === 'project' && modelsEntry !== undefined ? ((catalog.answerOf(modelsEntry, 'user').own ?? []) as readonly TeamEdit[]) : [],
  );
  const reviewAnswer = $derived(reviewEntry === undefined ? undefined : catalog.answerOf(reviewEntry, scope));
  const policy = $derived(((reviewAnswer?.own ?? reviewAnswer?.inherited) as ReviewPolicy | undefined) ?? NO_REVIEW);

  const groups = $derived(
    [...new Set(rows.map((row) => row.provider))].map((provider) => {
      const held = rows.filter((row) => row.provider === provider);
      return {
        provider,
        on: providerOn(edits, provider, !off.includes(provider)),
        count: held.length,
        lines: modelLines(providers.models, held),
      };
    }),
  );

  const nameOf = (row: TeamModelKey): string => {
    const named = rowName(providers.models, row);
    return named.rung === null ? named.label : `${named.label} ${named.rung}`;
  };
  const marked = $derived(listed.filter((row) => row.reviews).map(nameOf));

  const busy = $derived(catalog.busyKey === MODELS);

  const outcome = (key: string) => {
    const said = catalog.outcomes[key];
    return said?.kind === 'refused' ? said.reason : null;
  };

  let opened = $state<string | null>(null);
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
      (key) => ({ name: nameOf(key), names: [key.model] }),
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

  function check(row: TeamModel, field: RowCheck, value: boolean): void {
    void write(MODELS, withEdit(edits, { ...keyOf(row), ...(field === 'on' ? { on: value } : { reviews: value }) }));
  }

  function rewrite(row: TeamModel, set: RowFields, drop: readonly RowField[]): void {
    const written = Object.keys(set).length === 0 ? edits : withEdit(edits, { ...keyOf(row), ...set });
    void write(MODELS, withoutFields(written, row, drop));
  }

  function remove(row: TeamModel): void {
    opened = null;
    const kept = withoutRow(edits, row);
    void write(MODELS, row.shipped !== null || editsRow(below, row) ? [...kept, { ...keyOf(row), removed: true }] : kept);
  }

  function add(key: TeamModelKey): void {
    picking = false;
    opened = rowKey(key);
    const buried = edits.some((one) => 'model' in one && sameRow(one, key) && one.removed === true);
    const added = withEdit(buried ? withoutRow(edits, key) : edits, { ...key, on: true });
    const shown = providerOn(edits, key.provider, !off.includes(key.provider));
    void write(MODELS, shown ? added : withEdit(added, { provider: key.provider, on: true }));
  }
</script>

<Group title="Models for sub-agents">
  {#snippet act()}
    {#if own !== undefined}
      <Button variant="ghost" size="xs" disabled={busy} onclick={() => void write(MODELS)}>Reset to default</Button>
    {/if}
  {/snippet}
  <div class="grid" data-setting={MODELS}>
    <p class="pb-3 text-small text-muted-foreground">
      Agents start a child on a model checked under Work and a reviewer on one checked under Review: each time the cheapest whose ratings
      meet the task. Click a row to rate it.
    </p>
    <div class="-mx-1.5 flex h-6 items-center gap-2 px-1.5 text-meta text-muted-foreground" aria-hidden="true">
      <span class="w-9 shrink-0 text-center">Work</span>
      <span class="w-9 shrink-0 text-center">Review</span>
      <span class="w-34 shrink-0">Model</span>
      <span class="w-12 shrink-0"></span>
      {#each AXES as axis (axis.field)}<span class="w-15 shrink-0">{axis.label}</span>{/each}
    </div>
    {#each groups as group, index (group.provider)}
      <div class={['flex items-center gap-2', index === 0 ? 'h-8' : 'mt-1.5 h-10 border-t border-vein pt-2']}>
        <span class="flex w-9 shrink-0 justify-center">
          <input
            type="checkbox"
            aria-label={`All of ${providers.modeName(group.provider)}`}
            title="Off keeps every row of this provider out, whatever its own checks"
            checked={group.on}
            disabled={busy}
            onchange={(event) => void write(MODELS, withEdit(edits, { provider: group.provider, on: event.currentTarget.checked }))}
          />
        </span>
        <ProviderMark provider={group.provider} titled={false} class="size-3.5" />
        <span class={['text-ui font-medium', !group.on && 'text-muted-foreground']}><ProviderHeading provider={group.provider} /></span>
        {#if !group.on}
          <span class="text-small text-muted-foreground">{group.count} model{group.count === 1 ? '' : 's'}, off</span>
        {/if}
        <span class="flex-1"></span>
        {#if group.on}
          <Usage provider={group.provider} part="gauge" marked={false} />
          <Usage provider={group.provider} part="percent" />
        {/if}
      </div>
      {#if group.on}
        {#each group.lines as line (line.key)}
          {#each line.rows as { step, row }, at (rowKey(row))}
            {@const key = rowKey(row)}
            {@const edit = rowEdit(edits, row)}
            {@const under = rowEdit(below, row)}
            <ListRow
              {row}
              label={at === 0 ? line.label : null}
              rung={step?.label ?? null}
              named={nameOf(row)}
              work={row.on}
              review={row.reviews}
              edited={(field) => ratingEdited(edit, under, row, field)}
              open={opened === key}
              disabled={busy}
              oncheck={(field, value) => check(row, field, value)}
              onopen={() => (opened = opened === key ? null : key)}
            />
            {#if opened === key}
              <ModelCard
                {row}
                {edit}
                below={under}
                offered={listed.some((one) => sameRow(one, row))}
                disabled={busy}
                onwrite={(set, drop) => rewrite(row, set, drop)}
                onremove={() => remove(row)}
              />
            {/if}
          {/each}
        {/each}
      {/if}
    {:else}
      <p class="py-3 text-small text-muted-foreground">No rows: connect a provider or add a model.</p>
    {/each}
    {#if outcome(MODELS) !== null}<p class="pt-2 text-small text-destructive">{outcome(MODELS)}</p>{/if}
    <div class="pt-1.5">
      <Popover.Root
        bind:open={picking}
        onOpenChange={(next) => {
          if (next) search = '';
        }}
      >
        <Popover.Trigger
          class="-ml-2 inline-flex h-7 items-center gap-1 rounded-md px-2 text-ui transition-colors hover:bg-hover disabled:opacity-50"
          disabled={busy}
        >
          <Plus class="size-3.5" /> Add model
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

<Group title="Review of sub-agents’ work">
  {#snippet act()}
    {#if reviewAnswer?.own !== undefined}
      <Button variant="ghost" size="xs" disabled={catalog.busyKey === REVIEW} onclick={() => void write(REVIEW)}>Reset to default</Button>
    {/if}
  {/snippet}
  <div class="grid" data-setting={REVIEW}>
    <ReviewForm {policy} {marked} disabled={catalog.busyKey === REVIEW} onchange={(next) => void write(REVIEW, next)} />
    {#if outcome(REVIEW) !== null}<p class="text-small text-destructive">{outcome(REVIEW)}</p>{/if}
  </div>
</Group>
