<script lang="ts">
  import type { CompactionSummarizersRead } from '@tagma/server/native-harness/contract/wire/compactionChoices';
  import { untrack } from 'svelte';
  import { paysWords, skipWords } from '$lib/features/providers/usage/spendWords.js';
  import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import type { Row, RowNote } from '$lib/features/settings/controls/rows.js';
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import { pick, rest, type SectionProps } from '$lib/features/settings/section.js';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import TeamSettings from './team/TeamSettings.svelte';

  let { catalog, scope, project }: SectionProps = $props();

  const DELEGATION = ['agent.delegation', 'agent.subAgentDepth', 'agent.toolOutputShare', 'agent.checkout', 'agent.checkoutWorld'];
  const APPROVALS = ['agent.approvalMode', 'agent.worktrees', 'agent.operatorNotice'];
  const INSTRUCTIONS = ['agent.contextFiles.enabled', 'agent.contextFiles.names'];
  const COMPACTION = ['agent.compactionStrategy', 'agent.compactionTrigger', 'agent.compactionOverrides'];
  const SUMMARIZERS = ['agent.compactionSummarizerRule', 'agent.compactionSummarizers'];
  const WARM = ['agent.keepWarm', 'agent.keepWarmPings'];
  const TYPES = ['agent.default', 'agent.offered'];
  const MODELS = ['agent.models', 'agent.review'];
  const WEB = ['agent.web', 'agent.images'];
  const CLAIMED = [...DELEGATION, ...APPROVALS, ...INSTRUCTIONS, ...COMPACTION, ...SUMMARIZERS, ...WARM, ...TYPES, ...MODELS, ...WEB];
  const CHAIN = 'agent.compactionSummarizers';

  const repo = SettingsRepo.use();
  const accounts = UsageAccounts.use();
  const providers = ProviderCatalog.use();

  const entries = $derived(catalog.entriesOf('agent'));

  const dimmed = $derived.by(() => {
    const reading = entries.find((entry) => entry.id === 'agent.contextFiles.enabled');
    if (reading === undefined) return [];
    const answer = catalog.answerOf(reading, scope);
    const on = (answer.own === undefined ? answer.inherited : answer.own) === true;
    return on ? [] : ['agent.contextFiles.names'];
  });

  const standingBasis = $derived(
    JSON.stringify([
      scope,
      pick(entries, SUMMARIZERS).map((entry) => catalog.answerOf(entry, scope)),
      accounts.rows.map((row) => [row.provider, String(row.account), row.default, row.failedAt, row.quota?.windows ?? null]),
    ]),
  );
  let standing = $state.raw<CompactionSummarizersRead | null>(null);

  $effect(() => {
    void standingBasis;
    const layer = scope;
    const projectId = catalog.projectId;
    let current = true;
    untrack(() =>
      repo.summarizers
        .run({ projectId, layer })
        .then((read) => {
          if (current && read) standing = read;
        })
        .catch(() => {
          if (current) standing = null;
        }),
    );
    return () => {
      current = false;
    };
  });

  function chainNote(row: Row): RowNote | null {
    const member = standing?.chain.find((entry) => entry.provider === row.provider && entry.model === row.model);
    if (member === undefined) return null;
    if (member.skip === null)
      return { tone: 'ready', text: `can be spent · ${paysWords(providers.models, member.pays, accounts.rows)} pays` };
    return { tone: 'blocked', text: skipWords(member.skip.reason, member.skip.until, Date.now()) };
  }
</script>

<div class="grid">
  <KeyCard title="Delegation and context" entries={pick(entries, DELEGATION)} {catalog} {scope} {project} />
  <KeyCard title="Approvals" entries={pick(entries, APPROVALS)} {catalog} {scope} {project} />
  <KeyCard title="Instruction files" entries={pick(entries, INSTRUCTIONS)} {dimmed} {catalog} {scope} {project} />
  <KeyCard title="Compaction" entries={pick(entries, COMPACTION)} {catalog} {scope} {project} />
  <KeyCard
    title="Who summarizes a compaction"
    entries={pick(entries, SUMMARIZERS)}
    rowNotes={{ [CHAIN]: chainNote }}
    {catalog}
    {scope}
    {project}
  />
  <KeyCard title="Warm cache" entries={pick(entries, WARM)} {catalog} {scope} {project} />
  <KeyCard title="Agent types" entries={pick(entries, TYPES)} {catalog} {scope} {project} />
  <TeamSettings {catalog} {scope} {project} />
  <KeyCard title="Web and pictures" entries={pick(entries, WEB)} {catalog} {scope} {project} />
  {#if rest(entries, CLAIMED).length > 0}
    <KeyCard title="More" entries={rest(entries, CLAIMED)} {catalog} {scope} {project} />
  {/if}
</div>
