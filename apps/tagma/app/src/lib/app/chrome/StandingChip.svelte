<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import CircleArrowUp from '@lucide/svelte/icons/circle-arrow-up';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { InstallProgress, NextOffer, NextStep } from '@tagma/server/installation/contract/wire/next';
  import { labelRevision } from '@tagma/server/installation/contract/wire/layout';
  import AgentIcon from '$lib/shared/AgentIcon.svelte';
  import Bar from '$lib/shared/ui/Bar.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import Told from '$lib/shared/Told.svelte';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { cn } from '$lib/shared/utils.js';
  import { Host } from '@runlith/layer/Host';
  import { DesktopUpdates } from '$lib/shared/desktop/DesktopUpdates.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { spellModifier } from '$lib/shared/chordSpelling.js';
  import { Restart } from '$lib/wire/Restart.svelte.js';
  import { LIVE_TROUBLE } from './liveTrouble.js';
  import { Standing } from './Standing.svelte.js';
  import InstallFailed from './InstallFailed.svelte';
  import NewHostCard from './NewHostCard.svelte';
  import { shortBuild } from './newHost.js';
  import SurfaceRow from './SurfaceRow.svelte';
  import { WireState } from './WireState.svelte.js';

  const standing = Standing.use();
  const restart = Restart.use();
  const wire = WireState.use();
  const trouble = $derived(LIVE_TROUBLE[wire.status]);

  let open = $state(false);
  let now = $state(Date.now());
  $effect(() => {
    const tick = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(tick);
  });

  $effect(() => {
    if (open) void standing.read();
  });

  const updates = DesktopUpdates.find();
  $effect(() =>
    updates?.onCheck(() => {
      open = true;
      void standing.check();
    }),
  );

  let holdOpen = $state(false);
  let altHeld = $state(false);
  let altPinned = $state(false);
  const apple = Host.use().apple;
  const buildOnly = $derived(altHeld || altPinned);

  $effect(() => {
    if (open) return;
    holdOpen = false;
    altPinned = false;
  });

  $effect(() => {
    if (!open) return;
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Alt') altHeld = true;
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === 'Alt') altHeld = false;
    };
    const lost = () => (altHeld = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', lost);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', lost);
      altHeld = false;
    };
  });

  const machine = $derived(standing.machine);
  const health = $derived(standing.health);
  const acting = $derived(standing.acting);
  const next = $derived(standing.next);
  const installing = $derived(next?.installing ?? null);
  const installed = $derived(next?.installed ?? null);
  const host = $derived(machine?.host ?? null);
  const running = $derived(host?.holds?.running ?? []);

  const short = shortBuild;

  const secondsSince = (from: string | number | null | undefined, at: number): number =>
    from === null || from === undefined ? 0 : Math.max(0, Math.round((at - (typeof from === 'number' ? from : Date.parse(from))) / 1000));

  const ago = (from: string | number | null | undefined, at: number): string => {
    if (from === null || from === undefined) return '';
    const seconds = secondsSince(from, at);
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h`;
    return `${Math.floor(hours / 24)} d`;
  };

  const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

  const counted = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

  const runs = $derived.by((): { readonly head: string; readonly dirty: boolean } | null => {
    const server = machine?.server;
    const label = server?.installation?.build ?? health?.source.installation?.build;
    if (label !== undefined) return labelRevision(label);
    const cut = server?.cut?.revision ?? health?.source.cut?.revision ?? null;
    return cut === null ? null : { head: cut.head, dirty: cut.dirty };
  });

  const heldWords = $derived.by(() => {
    const holds = host?.holds;
    if (!holds || holds.running.length === 0) return null;
    return [holds.terminals > 0 ? counted(holds.terminals, 'terminal') : '', holds.commands > 0 ? counted(holds.commands, 'command') : '']
      .filter(Boolean)
      .join(', ');
  });

  const keeps = $derived.by(() => {
    const holds = host?.holds;
    if (host === null || holds === null || holds === undefined) return 'what the host holds is unknown';
    return heldWords === null ? 'nothing is running' : `keeps ${heldWords} running`;
  });

  type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'off';
  type Said = { readonly text: string; readonly strong?: boolean };

  const TONE: Record<Tone, string> = {
    ok: 'bg-status-done',
    info: 'bg-status-open',
    warn: 'bg-status-in-work',
    bad: 'bg-destructive',
    off: 'bg-muted-foreground/50',
  };

  const INK: Record<Tone, string> = { ok: '', info: 'text-status-open', warn: 'text-status-in-work', bad: 'text-destructive', off: '' };

  const STANDING_TONE: Record<'latest' | 'behind' | 'apart' | 'alone', Tone> = { latest: 'ok', behind: 'info', apart: 'info', alone: 'ok' };

  const stateLine = $derived.by((): { readonly tone: Tone; readonly said: readonly Said[] } => {
    if (standing.quietSince !== null) {
      return {
        tone: 'off',
        said: [
          { text: `Not answering for ${ago(standing.quietSince, now)}` },
          { text: standing.readAt === null ? '' : ` · this is the reading from ${ago(standing.readAt, now)} ago` },
        ],
      };
    }
    if (next === null) return { tone: 'off', said: [] };
    const updated =
      installed?.outcome === 'landed' &&
      installed.then === 'restart' &&
      installed.restartRefused === null &&
      secondsSince(installed.endedAt, now) < 3600
        ? [{ text: `Updated ${ago(installed.endedAt, now)} ago · ` }]
        : [];
    return { tone: STANDING_TONE[next.standing.tone], said: [...updated, ...next.standing.said] };
  });

  const RESTART_STEP: NextStep = { id: 'restart', title: 'Restart', weight: 1.5 };

  type Progress = {
    readonly title: string;
    readonly target: string | null;
    readonly offer: string | null;
    readonly stages: readonly NextStep[];
    readonly active: string;
    readonly since: string | null;
    readonly usually: number | null;
    readonly bytes: InstallProgress | null;
    readonly line: string;
    readonly foot: string;
    readonly stoppable: boolean;
    readonly stopping: boolean;
  };

  const carried = (bytes: InstallProgress): string =>
    bytes.total === null ? `${megabytes(bytes.done)} received` : `${megabytes(bytes.done)} of ${megabytes(bytes.total)}`;

  const progress = $derived.by((): Progress | null => {
    if (acting?._tag === 'Restart') {
      const update = acting.update;
      const silence =
        restart.quietSince === null ? 'Waiting for Tagma to start again' : `Tagma has not answered for ${ago(restart.quietSince, now)}`;
      if (update !== null) {
        return {
          title: 'Updating to',
          target: short(acting.onto),
          offer: update.title,
          stages: update.steps,
          active: RESTART_STEP.id,
          since: update.since,
          usually: null,
          bytes: null,
          line: silence,
          foot: keeps,
          stoppable: false,
          stopping: false,
        };
      }
      const current = machine?.server.installation?.build ?? health?.source.installation?.build ?? null;
      return {
        title: acting.onto !== current && current !== null ? 'Restarting onto' : 'Restarting · same installation',
        target: acting.onto === current || current === null ? null : short(acting.onto),
        offer: null,
        stages: [RESTART_STEP],
        active: RESTART_STEP.id,
        since: null,
        usually: null,
        bytes: null,
        line: silence,
        foot: keeps,
        stoppable: false,
        stopping: false,
      };
    }
    const followed = installing ?? (acting?._tag === 'Install' ? acting.installing : null);
    if (followed === null) return null;
    const restarts = followed.then === 'restart';
    const stopping = standing.stopping === followed.since;
    return {
      title: restarts ? 'Updating to' : 'Installing',
      target: short(followed.target),
      offer: followed.title,
      stages: followed.steps,
      active: followed.step,
      since: followed.since,
      usually: followed.usually,
      bytes: followed.progress,
      line: stopping
        ? 'Stopping the installation'
        : followed.progress !== null
          ? carried(followed.progress)
          : followed.step === RESTART_STEP.id
            ? 'Waiting for Tagma to start again'
            : '',
      foot: restarts ? keeps : 'restart when you choose',
      stoppable: followed.step !== RESTART_STEP.id,
      stopping,
    };
  });

  const segments = $derived.by(() => {
    if (progress === null) return [];
    const total = progress.stages.reduce((sum, stage) => sum + stage.weight, 0);
    const at = progress.stages.findIndex((stage) => stage.id === progress.active);
    const overall =
      progress.usually === null || progress.since === null
        ? null
        : Math.min(0.97, (secondsSince(progress.since, now) * 1000) / progress.usually);
    let start = 0;
    return progress.stages.map((stage, index) => {
      const width = stage.weight / total;
      const state = index < at ? 'done' : index === at ? 'active' : 'waiting';
      const bytes = state === 'active' ? progress.bytes : null;
      const fill =
        state === 'done'
          ? 1
          : state === 'waiting'
            ? 0
            : bytes !== null && bytes.total !== null && bytes.total > 0
              ? Math.min(1, bytes.done / bytes.total)
              : overall === null
                ? null
                : Math.min(0.95, Math.max(0.08, (overall - start) / width));
      start += width;
      return { stage, weight: stage.weight, state, fill };
    });
  });

  function halt(): void {
    if (progress === null || progress.since === null || !progress.stoppable) return;
    void standing.stop(progress.since);
  }

  const failed = $derived(
    installed !== null && installed.outcome === 'failed' && acting === null && installing === null ? installed : null,
  );

  const readyFrom = $derived.by(() => {
    const ready = standing.ready;
    if (ready === null || installed === null || installed.build !== ready) return null;
    return `from ${installed.title} · ${ago(installed.endedAt, now)} ago`;
  });

  const megabytes = (bytes: number): string => `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;

  type Row = {
    readonly offer: NextOffer;
    readonly sub: string;
    readonly meta: string;
    readonly disabled: boolean;
  };

  const rowOf = (offer: NextOffer): Row => ({
    offer,
    sub: offer.disabled ?? `${offer.detail}${offer.irreversible === true ? ' · no step back once it runs' : ''}`,
    meta: [offer.label, offer.size === null ? '' : megabytes(offer.size)].filter(Boolean).join(' · '),
    disabled: acting !== null || installing !== null || offer.disabled !== null,
  });

  const rows = $derived((next?.offers ?? []).map(rowOf));
  const backRow = $derived(next?.back === null || next?.back === undefined ? null : rowOf(next.back));
  const whys = $derived(
    [...rows, ...(backRow === null ? [] : [backRow])].flatMap((row) => (row.offer.why === null ? [] : [row.offer.why])),
  );

  function press(row: Row, quiet: boolean): void {
    if (row.disabled) return;
    void (quiet ? standing.install(row.offer.id) : standing.update(row.offer.id));
  }

  const chip = $derived.by(
    (): { readonly tone: Tone; readonly word: string; readonly spin: boolean; readonly behind: number; readonly note: string } => {
      const plain = { spin: false, behind: 0, note: 'Where the server and its execution host stand' };
      if (acting !== null) {
        if (acting._tag === 'Restart')
          return {
            ...plain,
            tone: 'warn',
            word: `restarting${restart.since !== null ? ` ${secondsSince(restart.since, now)} s` : ''}`,
            spin: true,
          };
        const started = acting.installing;
        return {
          ...plain,
          tone: 'warn',
          word:
            standing.stopping === started.since
              ? 'stopping'
              : `${started.then === null ? 'installing' : 'updating'} ${clock(secondsSince(started.since, now))}`,
          spin: true,
        };
      }
      if (installing !== null)
        return {
          ...plain,
          tone: 'warn',
          word: standing.stopping === installing.since ? 'stopping' : `installing ${clock(secondsSince(installing.since, now))}`,
          spin: true,
        };
      if (trouble !== null) return { ...plain, tone: trouble.tone, word: trouble.word, note: trouble.note };
      if (standing.quietSince !== null) return { ...plain, tone: 'off', word: `not answering ${ago(standing.quietSince, now)}` };
      if (health === null) return { ...plain, tone: 'off', word: '' };
      if (host !== null && host.presence !== 'answering') return { ...plain, tone: 'bad', word: 'host down' };
      if (installed?.outcome === 'failed' && secondsSince(installed.endedAt, now) < 3600)
        return { ...plain, tone: 'bad', word: 'install failed' };
      if (standing.newHost?.cause === 'update') return { ...plain, tone: 'warn', word: 'update ready' };
      if (standing.ready !== null) return { ...plain, tone: 'warn', word: 'restart to update' };
      const behind = next?.standing.behind ?? null;
      return {
        tone: 'ok',
        word: runs === null ? '' : runs.head.slice(0, 7),
        spin: false,
        behind: behind === null ? 0 : (next?.standing.behindBy ?? 0),
        note: behind === null ? plain.note : `${behind} to update`,
      };
    },
  );
  const spoken = $derived(
    ['Tagma beta', chip.word, chip.behind > 0 ? chip.note : null].filter((part) => part !== null && part !== '').join(', '),
  );

  const hostTone = $derived.by((): Tone => {
    if (host === null) return 'off';
    if (host.presence !== 'answering') return 'bad';
    return 'ok';
  });

  function restartNow(): void {
    const act = standing.act('restart');
    if (act === null || act.disabled !== null) return;
    void standing.restart();
  }

  const retry = (offer: string, restarts: boolean): void => {
    void (restarts ? standing.update(offer) : standing.install(offer));
  };

  const commandAct = $derived(standing.act('command'));
  const hostName = $derived(host?.build === null || host?.build === undefined ? 'unnamed build' : short(host.build));
  const serverAge = $derived.by(() => {
    const server = machine?.server;
    if (!server) return '';
    return server.born.replacedPid === null ? `up ${ago(server.startedAt, now)}` : `restarted ${ago(server.startedAt, now)} ago`;
  });

  const BUTTON =
    'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-input px-2 text-small font-medium whitespace-nowrap transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-45';
</script>

{#snippet dot(tone: Tone)}
  <span class={cn('size-1.5 shrink-0', TONE[tone])}></span>
{/snippet}

{#snippet offerRow(row: Row, Icon: typeof CircleArrowUp, verb: string, quiet: boolean)}
  <button
    type="button"
    class="group grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 border-border px-3 py-2 text-left transition-colors not-first:border-t enabled:hover:bg-hover focus-visible:bg-selected focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-default"
    disabled={row.disabled}
    data-standing-update-row={row.offer.id}
    onclick={() => press(row, quiet)}
  >
    <Icon class="size-4 text-muted-foreground transition-colors group-enabled:group-hover:text-foreground group-disabled:opacity-50" />
    <span class="grid min-w-0 gap-px">
      <span class="flex items-center gap-2 font-medium group-disabled:opacity-50">
        {row.offer.title}
        {#if row.offer.current}
          <span class="stamp rounded-sm bg-status-done/15 px-1.5 text-meta leading-[15px] text-status-done">running</span>
        {/if}
      </span>
      <span class={cn('text-small text-muted-foreground', row.offer.disabled === null && 'truncate')}>{row.sub}</span>
    </span>
    <span class="grid items-center justify-items-end *:[grid-area:1/1]">
      <span
        class="stamp text-meta text-muted-foreground transition-opacity group-enabled:group-hover:opacity-0 group-focus-visible:opacity-0"
        >{row.meta}</span
      >
      <span
        class={cn(
          'translate-x-1 rounded-md px-3 py-1.5 text-small leading-none font-semibold whitespace-nowrap opacity-0 transition group-enabled:group-hover:translate-x-0 group-enabled:group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100',
          quiet ? 'text-foreground outline-1 outline-input' : 'bg-primary text-primary-foreground',
        )}
      >
        {verb}
      </span>
    </span>
  </button>
{/snippet}

<Popover.Root bind:open>
  <Tooltip text={chip.note}>
    <Popover.Trigger
      class="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground"
      aria-label={spoken}
      data-standing-chip={chip.tone}
    >
      {#if chip.spin}
        <Waiting class="size-3 text-status-in-work" />
      {:else}
        {@render dot(chip.tone)}
      {/if}
      <span class="whitespace-nowrap">Tagma</span>
      <span class="whitespace-nowrap text-muted-foreground">beta</span>
      {#if chip.word !== ''}
        <span class={cn('whitespace-nowrap tabular-nums', INK[chip.tone])} data-standing-word>{chip.word}</span>
      {/if}
      {#if chip.behind > 0}
        <span class="whitespace-nowrap tabular-nums opacity-70" data-standing-update>↓{chip.behind}</span>
      {/if}
    </Popover.Trigger>
  </Tooltip>
  <span class="sr-only" role="status" data-live={wire.status}>{trouble?.word ?? ''}</span>

  <Popover.Content align="start" side="top" sideOffset={8} class="w-96 gap-0 p-0 text-ui shadow-raised">
    <div class="grid grid-cols-1 gap-1.5 px-3 pt-3 pb-2" data-standing-head>
      <div class="flex min-w-0 items-center gap-2">
        <AgentIcon brand class="size-3.5 shrink-0" />
        <span class="text-ui font-bold">Tagma</span>
        <span class="text-ui text-muted-foreground">beta</span>
        {#if runs !== null}
          <span class="stamp text-small text-foreground">{runs.head.slice(0, 7)}</span>
          {#if runs.dirty}
            <span class="stamp rounded-sm border border-border px-1 text-meta leading-[15px] text-muted-foreground">dirty</span>
          {/if}
        {/if}
      </div>
      <p class="flex items-baseline gap-2 text-ui leading-snug text-muted-foreground">
        <span class={cn('mx-1 size-1.5 shrink-0 -translate-y-px', TONE[stateLine.tone])}></span>
        <span>
          {#each stateLine.said as part, index (index)}
            {#if part.strong}<b class="font-medium text-foreground">{part.text}</b>{:else}{part.text}{/if}
          {/each}
        </span>
      </p>
    </div>

    {#if progress !== null}
      <div class="grid grid-cols-1 gap-2 border-t border-border px-3 py-3" aria-live="polite" data-standing-progress>
        <div class="flex items-baseline justify-between gap-3">
          <span class="min-w-0 truncate font-semibold">
            {progress.title}
            {#if progress.target !== null}<span class="stamp text-small">{progress.target}</span>{/if}
          </span>
          {#if progress.since !== null}
            <span class="stamp shrink-0 text-meta">
              {clock(secondsSince(progress.since, now))}{#if progress.usually !== null}<span class="text-muted-foreground">
                  · usually {clock(progress.usually / 1000)}</span
                >{/if}
            </span>
          {/if}
        </div>
        <ol class="flex gap-0.5">
          {#each segments as segment (segment.stage.id)}
            <li class="grid min-w-0 basis-0 gap-1.5" style:flex-grow={segment.weight}>
              <Bar
                used={(segment.fill ?? 1) * 100}
                color={segment.state === 'done' ? 'var(--status-done)' : 'var(--status-in-work)'}
                class={['h-1', segment.state === 'active' && segment.fill === null && 'animate-pulse']}
              />
              <span class={cn('stamp truncate text-meta', segment.state === 'active' ? 'text-foreground' : 'text-muted-foreground')}>
                {#if segment.state === 'done'}<span class="text-status-done">✓ </span>{/if}{segment.stage.title}
              </span>
            </li>
          {/each}
        </ol>
        {#if progress.line !== ''}
          <div class="flex min-w-0 text-small text-muted-foreground" data-standing-line>
            <span class="truncate">{progress.line}</span>
          </div>
        {/if}
        <div class="flex min-h-6 items-center justify-between gap-3 text-small text-muted-foreground">
          <span class="truncate">{progress.offer === null ? '' : `${progress.offer} · `}{progress.foot}</span>
          {#if progress.stoppable}
            <button
              type="button"
              class={cn(BUTTON, 'border-destructive/50 text-destructive hover:bg-hover-danger')}
              disabled={progress.stopping}
              data-standing-stop
              onclick={halt}
            >
              {progress.stopping ? 'Stopping…' : 'Stop'}
            </button>
          {/if}
        </div>
      </div>
    {:else if standing.quietSince === null && (rows.length > 0 || backRow !== null || standing.ready !== null || standing.newHost !== null || failed !== null)}
      <div class="grid grid-cols-1 gap-2 border-t border-border p-3" data-standing-update>
        {#if failed !== null}
          <div data-standing-built>
            <InstallFailed
              {failed}
              title={`${failed.title} ${short(failed.target)} was not installed ${ago(failed.endedAt, now)} ago; the version you have keeps working.`}
              retry={standing.offer(failed.offer)?.disabled === null ? () => retry(failed.offer, failed.then !== null) : undefined}
            />
          </div>
        {/if}
        {#if standing.newHost !== null}
          <NewHostCard needed={standing.newHost} place="popover" />
        {:else if standing.ready !== null}
          <div
            class="flex items-center gap-2 rounded-lg border border-status-in-work/30 bg-status-in-work/10 px-3 py-2"
            data-standing-ready
          >
            <div class="grid min-w-0 flex-1 gap-0.5">
              <span class="font-semibold">Installation <span class="stamp text-small">{short(standing.ready)}</span> is ready</span>
              <span class="truncate text-small text-muted-foreground">{readyFrom ?? 'stands, and is not running yet'}</span>
              <span class="text-small text-muted-foreground">Your terminals and agents keep running through the update.</span>
            </div>
            <button
              type="button"
              class={cn(BUTTON, 'h-7 border-transparent bg-primary px-3 text-primary-foreground hover:opacity-90')}
              onclick={restartNow}
            >
              Restart to apply
            </button>
          </div>
        {/if}
        {#if rows.length > 0 || backRow !== null}
          <div class="eyebrow px-1 pt-0.5 text-muted-foreground">Update to</div>
          <div class="grid grid-cols-1 overflow-hidden rounded-lg border border-border bg-sunken/35" role="group" aria-label="Update to">
            {#each rows as row (row.offer.id)}
              {@render offerRow(row, CircleArrowUp, buildOnly ? 'Install only' : row.offer.current ? 'Reinstall' : 'Update', buildOnly)}
            {/each}
            {#if backRow !== null}
              {@render offerRow(backRow, Undo2, 'Step back', false)}
            {/if}
          </div>
          {#if whys.length > 0}
            <Told told={{ text: '', details: whys }} class="px-1" />
          {/if}
          <div class="flex items-center justify-between gap-2 px-1 text-small text-muted-foreground">
            <span class="truncate">{buildOnly ? 'Installs only · restart when you choose' : `Installs, then restarts · ${keeps}`}</span>
            <button
              type="button"
              class={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-small transition-colors hover:bg-hover hover:text-foreground',
                buildOnly && 'text-foreground',
              )}
              aria-pressed={buildOnly}
              onclick={() => (altPinned = !altPinned)}
            >
              <Kbd chord={spellModifier('alt', apple)} size="sm" class={buildOnly ? 'bg-primary text-primary-foreground' : undefined} />
              install only
            </button>
          </div>
        {/if}
      </div>
    {/if}

    {#if standing.problem !== null}
      <div class="border-t border-border px-3 py-2 text-destructive" data-standing-problem><Told told={standing.problem} /></div>
    {/if}

    <div class="grid grid-cols-1 gap-0.5 border-t border-border p-1.5" data-standing-processes>
      <div class="grid min-h-9 grid-cols-[6px_48px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md py-1 pr-1 pl-3" data-standing-server>
        {@render dot(standing.quietSince === null ? 'ok' : 'off')}
        <span class="font-medium">Server</span>
        <span class="stamp truncate text-meta text-muted-foreground">
          {standing.quietSince === null ? serverAge : `last answered ${ago(standing.readAt, now)} ago`}
        </span>
        <span class="flex items-center gap-0.5">
          {#if standing.ready === null}
            <button type="button" class={BUTTON} disabled={acting !== null || standing.quietSince !== null} onclick={restartNow}>
              Restart
            </button>
          {/if}
        </span>
      </div>

      <div
        class="grid min-h-9 grid-cols-[6px_48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-md py-1 pr-1 pl-3"
        data-standing-host
      >
        {@render dot(hostTone)}
        <span class="font-medium">Host</span>
        <span class="stamp flex min-w-0 items-center gap-1 truncate text-meta text-muted-foreground">
          {#if host === null}
            not read yet
          {:else if host.presence !== 'answering'}
            <span class="text-destructive">not answering</span>
          {:else}
            <span class="truncate">{hostName}{host.since === null ? '' : ` · up ${ago(host.since, now)}`} ·</span>
            {#if heldWords !== null}
              <button
                type="button"
                class="inline-flex shrink-0 items-center gap-0.5 text-foreground underline decoration-vein-strong underline-offset-2 hover:decoration-current"
                aria-expanded={holdOpen}
                data-standing-running
                onclick={() => (holdOpen = !holdOpen)}
              >
                {heldWords}<ChevronRight class={cn('size-3 transition-transform', holdOpen && 'rotate-90')} />
              </button>
            {:else}
              <span>{host.holds === null ? 'holds unknown' : 'idle'}</span>
            {/if}
          {/if}
        </span>
        {#if host !== null && host.presence !== 'answering'}
          <div class="col-span-3 col-start-2 flex items-start justify-between gap-2">
            <Told
              told={{ text: 'Terminals and commands cannot run until it answers again.', details: [host.detail] }}
              class="text-small text-muted-foreground"
            />
            <button
              type="button"
              class={cn(BUTTON, 'border-destructive/50 text-destructive hover:bg-hover-danger')}
              disabled={acting !== null || standing.act('restart')?.disabled !== null}
              onclick={restartNow}
            >
              Restart
            </button>
          </div>
        {/if}
        {#if host?.custody === 'other'}
          <div class="col-span-3 col-start-2 text-small text-muted-foreground">Held by another Tagma</div>
        {/if}
        {#if holdOpen && running.length > 0}
          <ul class="col-span-3 col-start-2 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 rounded-md bg-sunken/60 px-3 py-2">
            {#each running as row (row.execution)}
              <li class="flex min-w-0 justify-between gap-3 text-small">
                <span class="stamp min-w-0 truncate">{row.title}</span>
                <span class="stamp shrink-0 text-muted-foreground"
                  >{row.holder === 'operator' ? 'yours' : 'agent'}{row.since === null ? '' : ` · ${ago(row.since, now)}`}</span
                >
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      {#if commandAct !== null}
        <div
          class="grid min-h-9 grid-cols-[6px_48px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md py-1 pr-1 pl-3"
          data-standing-command
        >
          {@render dot(commandAct.disabled === null ? 'off' : 'ok')}
          <span class="font-medium">Shell</span>
          <span class="truncate text-small text-muted-foreground">
            {commandAct.disabled === null ? 'terminals cannot reach Tagma yet' : 'terminals reach Tagma'}
          </span>
          {#if commandAct.disabled === null}
            <button type="button" class={BUTTON} onclick={() => void standing.placeCommand()}>Connect</button>
          {/if}
        </div>
      {/if}

      <SurfaceRow {dot} button={BUTTON} />
    </div>

    <div
      class="flex items-center justify-end gap-2 rounded-b-md border-t border-border bg-sunken/40 py-1.5 pr-2 pl-3 stamp text-meta text-muted-foreground"
    >
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition-colors hover:bg-hover hover:text-foreground"
        aria-label="Check for updates"
        disabled={standing.checking}
        onclick={() => void standing.check()}
      >
        {standing.checking ? 'checking for updates' : standing.readAt === null ? 'not read yet' : `read ${ago(standing.readAt, now)} ago`}
        {#if standing.checking}
          <Waiting class="size-3" />
        {:else}
          <RefreshCw class="size-3" />
        {/if}
      </button>
    </div>
  </Popover.Content>
</Popover.Root>
