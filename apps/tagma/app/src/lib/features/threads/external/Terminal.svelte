<script lang="ts">
  import type { HarnessRowDetail } from '@tagma/server/threads/contract/wire/harness/externalSession';
  import { Host } from '@runlith/layer/Host';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { onDestroy, untrack } from 'svelte';
  import { exitCopy } from '$lib/features/executions/terminal/ExitOverlay.svelte';
  import TerminalPaneHost from '$lib/features/executions/terminal/PaneHost.svelte';
  import HolderLink from '$lib/features/executions/terminal/HolderLink.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Dictated from '$lib/features/executions/terminal/Dictated.svelte';
  import type { TerminalPane } from '$lib/features/executions/terminal/Pane.svelte.js';
  import { PANE_TITLE_HEIGHT_PX } from '$lib/features/executions/terminal/PaneTitle.svelte';
  import { terminalLastGrid } from '@tagma/server/executions/contract/wire/terminalBehavior';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import { ExecutionsRepo } from '$lib/features/executions/Repo.js';
  import { CommandActivity } from '$lib/features/executions/commands/Activity.svelte.js';
  import { Live } from '$lib/wire/Live.js';
  import { TerminalViews } from '$lib/features/executions/terminal/Views.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ThreadTerminal } from '../Terminal.svelte.js';
  import type { HarnessOpenAttempt } from '../OpenWatch.js';
  import { mentionReference } from '../Draft.svelte.js';
  import { ThreadsRepo } from '../Repo.js';
  import { ThreadList } from '../List.svelte.js';
  import { fileDrop } from '$lib/features/executions/terminal/fileDrop.js';
  import { LocalFiles } from '$lib/features/executions/terminal/LocalFiles.js';
  import { DROPPED_FILE_MAX_BYTES, DROPPED_FILE_TOO_LARGE } from '@tagma/server/threads/contract/wire/drops';
  import { MentionDrops, type MentionZone } from '../MentionDrops.svelte.js';
  import MentionSlot from '../MentionSlot.svelte';

  let {
    threadId,
    projectId,
    execution = null,
    harness = null,
    attempt = null,
  }: {
    threadId: string;
    projectId: number;
    execution?: { execution: string; incarnation: number } | null;
    harness?: HarnessRowDetail | null;
    attempt?: HarnessOpenAttempt | null;
  } = $props();

  const isMac = Host.use().apple;
  const workspace = Workspace.use();
  const settingsRepo = SettingsRepo.use();
  const addresses = Addresses.use();
  const paneSettings = {
    writeGrid: async (project: number, grid: { readonly cols: number; readonly rows: number }) => {
      try {
        await settingsRepo.write.run(
          { projectId: project, scope: 'project', key: terminalLastGrid.id, value: { columns: grid.cols, rows: grid.rows } },
          { throwOnError: true },
        );
      } catch {}
    },
  };
  const terminal = untrack(
    () =>
      new ThreadTerminal(
        threadId,
        projectId,
        execution,
        () => harness,
        attempt,
        ExecutionsRepo.use(),
        TerminalViews.use(),
        Live.use(),
        CommandActivity.use(),
        paneSettings,
      ),
  );
  onDestroy(() => terminal.drop());
  const pane = $derived(terminal.pane);
  const drawn = $derived(terminal.state);
  const cli = $derived(harness === null ? 'the CLI' : harness.presentation.label);

  const following = $derived(execution === null ? null : `${execution.execution}:${execution.incarnation}`);
  $effect(() => {
    void following;
    void terminal.read(untrack(() => execution));
  });

  $effect(() => {
    if (drawn.kind === 'ended') untrack(() => terminal.settle());
  });

  let stage = $state<HTMLElement | null>(null);
  const typable = $derived(pane !== null && drawn.kind === 'live' && pane.holder === null);
  const drops = MentionDrops.use();
  const zoneId = $props.id();
  const zone: MentionZone = {
    covers: (under) => typable && (stage?.contains(under) ?? false),
    own: () => threadId,
    holds: () => !typable,
    mention: (mentions) => {
      const typing = pane;
      if (typing === null) return;
      void typing.paste(`${mentions.map((mention) => mentionReference(mention.name, mention.title)).join(' ')} `);
      typing.focus();
    },
  };
  const dropState = $derived(drops.stateOf(zoneId, zone));
  $effect(() => drops.add(zoneId, zone));

  const threads = ThreadsRepo.use();
  const list = ThreadList.use();
  const restarting = $derived(list.busy(threadId, 'restart'));
  const files = fileDrop(LocalFiles.find(), async (file) => {
    if (file.size > DROPPED_FILE_MAX_BYTES) throw new Error(DROPPED_FILE_TOO_LARGE);
    const kept = await threads.drop.run({ id: threadId, projectId, file }, { throwOnError: true });
    if (kept === undefined) throw new Error('The upload was cancelled.');
    return kept.path;
  });

  const processEnded = $derived(harness?.process?.state === 'ended');
  const adopted = $derived(harness?.process?.origin === 'adopted');
  const homeName = $derived(workspace.find(projectId)?.name);
  const shellHref = $derived(
    adopted && execution !== null && homeName !== undefined
      ? addresses.terminal(`${execution.execution}:${execution.incarnation}`, homeName)
      : null,
  );

  function endedDetail(state: Extract<typeof drawn, { kind: 'ended' }>): { heading: string; detail: string } {
    if (state.ending !== null) return exitCopy(state.ending, harness === null ? null : cli);
    return { heading: `${cli} session ended`, detail: 'Its process is gone.' };
  }

  function restoringLine(restoring: { readonly done: number; readonly total: number | null }): string {
    if (restoring.total === null) return 'Restoring the screen…';
    const kiB = (bytes: number): number => Math.round(bytes / 1024);
    return `Restoring the screen — ${kiB(restoring.done)} of ${kiB(restoring.total)} KiB`;
  }
</script>

{#snippet dictation(pane: TerminalPane, element: HTMLElement)}
  <Dictated {pane} {element} />
{/snippet}

{#snippet card()}
  {#if drawn.kind === 'ended'}
    {@const copy = endedDetail(drawn)}
    <div class="over bottom">
      <div class="card" role="alert" data-cli-exit>
        <p class="heading">{copy.heading}</p>
        <p class="prompt">{copy.detail}</p>
        <div class="answers">
          {#if shellHref !== null}
            <a class="answer" href={shellHref} data-open-terminal>Open terminal</a>
          {:else}
            <button type="button" onclick={() => terminal.close()}>Close</button>
          {/if}
        </div>
      </div>
    </div>
  {:else if drawn.kind === 'failed' || drawn.kind === 'uncertain'}
    <div class="over bottom">
      <div class="card" role="alert" data-cli-session={drawn.kind}>
        <p class="heading">{drawn.kind === 'failed' ? `${cli} session failed` : `Whether ${cli} started is unknown`}</p>
        <p class="prompt">{drawn.failure ?? 'No reason was recorded.'}</p>
        <div class="answers">
          <button type="button" disabled={restarting} onclick={() => void list.restart(threadId)}>Start again</button>
        </div>
      </div>
    </div>
  {:else if drawn.kind === 'unreadable' && pane === null}
    <p class="state">{`Connecting to ${cli}…`}</p>
  {:else if drawn.kind === 'connecting'}
    <p class="state">{`Connecting to ${cli}…`}</p>
  {:else if drawn.kind === 'absent'}
    <p class="state">No terminal yet — it appears when the CLI starts its shell.</p>
  {:else if drawn.kind === 'replacing' && pane === null}
    <p class="state">The execution host is being replaced; the terminal returns when it stands.</p>
  {:else if drawn.kind === 'restoring'}
    <p class="state">{restoringLine(drawn)}</p>
  {/if}
{/snippet}

<div class="harness-terminal">
  <div class="stage" style:--pane-title-height={`${PANE_TITLE_HEIGHT_PX}px`} bind:this={stage}>
    {#if dropState !== null}
      <div
        class={[
          'pointer-events-none absolute inset-1 z-50 flex flex-wrap content-end justify-center gap-1.5 rounded-lg border-2 p-4',
          dropState === 'aimed' ? 'border-status-open' : 'border-dashed border-foreground/30',
        ]}
        data-mention-drop={dropState}
      >
        <MentionSlot state={dropState} incoming={drops.fresh(zone)} />
      </div>
    {/if}
    {#if pane !== null}
      {#if shellHref !== null && !processEnded}
        <div class="held" data-adopted-terminal>
          <FadeText class="flex-1" text={`${cli} runs in a terminal of this place`} />
          <a class="held-link" href={shellHref}>Open terminal</a>
        </div>
      {:else if pane.holder !== null}
        <div class="held">
          <HolderLink class="flex-1" holder={pane.holder} />
          {#if pane.ending === null}
            <button type="button" data-take-over disabled={pane.takingOver} onclick={() => void pane.takeOver()}> Take over </button>
          {/if}
        </div>
      {/if}
      <TerminalPaneHost {pane} {isMac} overlay={card} {dictation} {files} />
    {:else}
      {@render card()}
    {/if}
  </div>
</div>

<style>
  .harness-terminal {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--color-sunken);
  }
  .stage {
    position: relative;
    display: flex;
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 0;
  }
  .held {
    position: absolute;
    inset: 0 0 auto 0;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    height: var(--pane-title-height);
    padding: 0 calc(var(--spacing) * 2);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-sunken);
    color: var(--color-muted-foreground);
    font-size: var(--text-small);
  }
  .held button,
  .held-link {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0 calc(var(--spacing) * 2);
    color: var(--color-foreground);
  }
  .over {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(var(--spacing) * 4);
    pointer-events: none;
  }
  .over.bottom {
    align-items: flex-end;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: calc(var(--spacing) * 3);
    width: 100%;
    max-width: 28rem;
    padding: calc(var(--spacing) * 4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-raised);
    color: var(--color-foreground);
    box-shadow: var(--elevation-raised);
    pointer-events: auto;
  }
  .heading {
    font-size: var(--text-body);
    font-weight: 500;
    color: var(--color-foreground);
  }
  .prompt {
    font-size: var(--text-small);
    color: var(--color-muted-foreground);
    white-space: pre-wrap;
  }
  .state {
    margin: auto;
    font-size: var(--text-ui);
    color: var(--color-muted-foreground);
  }
  .answers {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: calc(var(--spacing) * 2);
  }
  .answers button,
  .answers .answer {
    max-width: 100%;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 3);
    white-space: pre;
  }
</style>
