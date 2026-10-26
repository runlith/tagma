<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import Equal from '@lucide/svelte/icons/equal';
  import FileMinus from '@lucide/svelte/icons/file-minus';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import FileQuestion from '@lucide/svelte/icons/file-question-mark';
  import FileText from '@lucide/svelte/icons/file-text';
  import History from '@lucide/svelte/icons/history';
  import X from '@lucide/svelte/icons/x';
  import type { AuthorshipSide } from '@tagma/server/change-record/contract/wire/authorship';
  import type { CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';
  import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import Diff from '@runlith/code-editor/Diff.svelte';
  import { displayLanguage } from '@runlith/utils/codeLanguage';
  import { Router } from '@runlith/layer/Router';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import PathText from '$lib/shared/PathText.svelte';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { CheckoutScreen } from './CheckoutScreen.js';
  import { Topics } from '$lib/shared/threads/Topics.svelte.js';
  import { isPicture } from './changeItem.js';
  import { CheckoutRepo } from './Repo.js';
  import CommitHistory from './CommitHistory.svelte';
  import { endsOf } from './diffEnds.js';
  import { DiffReading } from './DiffReading.svelte.js';
  import { diffRows } from './diffRows.js';
  import { DIFF_WIDTH, DIFF_WRAP, type DiffWidth, widthOf } from './diffWidth.js';
  import DiffWidthSwitch from './DiffWidthSwitch.svelte';
  import HandsInFile from './HandsInFile.svelte';
  import LineCount from './LineCount.svelte';
  import type { CommitRange } from './opened.js';
  import PictureDiff from './PictureDiff.svelte';
  import ReadingFailed from '$lib/shared/ReadingFailed.svelte';
  import { SHORT_SHA } from './reading.js';
  import ViewMenu from './ViewMenu.svelte';

  let {
    projectId,
    rootId,
    path,
    commit = null,
    range = null,
    side = null,
    onSide,
    lines = null,
    mine = null,
    mark,
    onBack,
    closable = true,
    onClose,
    onStep,
    onCommit,
    onOpenFile,
  }: {
    projectId: number;
    rootId: RootId;
    path: string;
    commit?: string | null;
    range?: CommitRange | null;
    side?: AuthorshipSide | null;
    onSide?: ((side: AuthorshipSide) => void) | undefined;
    lines?: CheckoutLines | null;
    mine?: string | null;
    mark?: string | undefined;
    onBack?: (() => void) | undefined;
    closable?: boolean;
    onClose: () => void;
    onStep?: ((step: 1 | -1) => void) | undefined;
    onCommit: (commit: string | null) => void;
    onOpenFile?: ((line: number | null) => void) | undefined;
  } = $props();

  const keymap = Keymap.use();
  const HALVES: readonly AuthorshipSide[] = ['staged', 'unstaged'];

  const marks = ReaderMarks.use();
  const onScreen = CheckoutScreen.use();
  const topics = Topics.use();
  const notices = Notices.use();
  const router = Router.use();
  const addresses = Addresses.use();

  $effect(() =>
    topics.offer(() => ({ kind: 'text', text: `About \`${path}\`${commit === null ? '' : ` at ${commit.slice(0, SHORT_SHA)}`}: ` })),
  );
  const wanted = $derived(widthOf(marks.widths.get(DIFF_WIDTH)));
  const wrap = $derived(marks.wraps.get(DIFF_WRAP) === true);

  const place = $derived(`${path}\u0000${commit ?? ''}\u0000${range?.base ?? ''}\u0000${side ?? ''}`);
  let historyAt = $state<string | null>(null);
  const history = $derived(historyAt === place);

  function flip(): void {
    historyAt = history ? null : place;
  }

  const reading = new DiffReading(
    CheckoutRepo.use(),
    () =>
      commit !== null
        ? range === null
          ? { projectId, rootId, path, commit }
          : { projectId, rootId, path, commit, base: range.base }
        : side === null
          ? { projectId, rootId, path }
          : { projectId, rootId, path, side },
    () => wanted,
  );

  const ends = $derived(endsOf({ commit, base: range?.base ?? null, side: commit === null ? side : null }));

  const hands = $derived(reading.hands(mine));
  const rows = $derived(reading.answer === null ? [] : diffRows(reading.answer, hands));
  let diff = $state<Diff | undefined>();

  let seenPath: string | undefined;
  let seenMark: string | undefined;

  $effect(() => {
    if (reading.refusedWide) reading.narrowToPatch();
  });

  $effect(() => {
    const here = path;
    const now = mark;
    if (seenPath !== here) {
      seenPath = here;
      seenMark = now;
      reading.narrow();
      return;
    }
    if (now === undefined || now === seenMark) return;
    seenMark = now;
    reading.refresh();
  });

  function expand(at: number, count: number): Promise<void> {
    return reading.expand({ at, lines: count }).catch((error: unknown) => notices.refusal(error));
  }

  let pane = $state<HTMLElement | null>(null);

  $effect(() => {
    place;
    const here = pane;
    if (here === null) return;
    const focused = document.activeElement;
    if (focused === null || focused === document.body) here.focus({ preventScroll: true });
  });

  const name = $derived(path.slice(path.lastIndexOf('/') + 1));

  const OWN_KEYS =
    'input, textarea, select, [contenteditable], [role="textbox"], [role="menu"], [role="menuitem"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

  const ownsKeys = (target: EventTarget | null): boolean =>
    target instanceof Element && !target.classList.contains('cm-content') && target.closest(OWN_KEYS) !== null;

  const LISTS = '[data-files-column], [data-checkout-list]';

  const inReach = (target: EventTarget | null): boolean =>
    target === null ||
    target === document ||
    target === document.body ||
    target === document.documentElement ||
    (target instanceof Node && pane?.contains(target) === true) ||
    (target instanceof Element && target.closest(LISTS) !== null);

  function keys(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!onScreen.mainFocused || ownsKeys(event.target) || !inReach(event.target)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (onStep === undefined) return;
    if (event.key === 'j' || event.key === 'k') {
      event.preventDefault();
      onStep(event.key === 'j' ? 1 : -1);
    }
  }

  const ICON =
    'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40';
</script>

<svelte:window onkeydown={keys} />

{#snippet stateOf(Icon: typeof Equal, title: string, detail: string, kind: string)}
  <div class="flex items-start gap-3 p-4" data-diff-state={kind}>
    <span class="grid size-8 shrink-0 place-items-center rounded-md border bg-hover text-foreground/80">
      <Icon class="size-4" />
    </span>
    <div class="grid min-w-0 gap-0.5">
      <p class="text-ui font-medium text-foreground">{title}</p>
      <p class="text-ui break-words text-foreground/75">{detail}</p>
    </div>
  </div>
{/snippet}

<section
  bind:this={pane}
  tabindex="-1"
  class="flex h-full min-h-0 min-w-0 flex-col bg-background outline-none"
  aria-label="Changes in {name}"
  data-diff-pane={path}
>
  <header class="flex h-8 shrink-0 items-center gap-1.5 border-b pr-1.5 pl-2">
    {#if onBack !== undefined}
      <Tooltip text="Back">
        <button type="button" class={ICON} aria-label="Back" onclick={onBack}><ArrowLeft class="size-3.5" /></button>
      </Tooltip>
    {/if}
    {#if range !== null}
      <span
        class="shrink-0 rounded-sm bg-hover px-1.5 py-0.5 font-mono text-meta text-muted-foreground"
        data-diff-range="{range.base}..{range.head}"
      >
        {range.base.slice(0, SHORT_SHA)}..{range.head.slice(0, SHORT_SHA)}
      </span>
    {:else if commit !== null}
      <span class="shrink-0 rounded-sm bg-hover px-1.5 py-0.5 font-mono text-meta text-muted-foreground" data-diff-commit={commit}>
        {commit.slice(0, SHORT_SHA)}
      </span>
    {:else if side !== null && onSide !== undefined}
      <span
        class="flex shrink-0 items-center rounded-sm bg-hover p-px text-meta"
        role="group"
        aria-label="Which half of the change"
        data-diff-side={side}
      >
        {#each HALVES as half (half)}
          <button
            type="button"
            class={[
              'rounded-sm px-1.5 py-px transition-colors',
              half === side ? 'bg-selected text-foreground' : 'text-muted-foreground hover:text-foreground',
            ]}
            aria-pressed={half === side}
            onclick={() => onSide(half)}
          >
            {half === 'staged' ? 'Staged' : 'Unstaged'}
          </button>
        {/each}
      </span>
    {:else if side !== null}
      <span class="shrink-0 rounded-sm bg-hover px-1.5 py-0.5 text-meta text-muted-foreground" data-diff-side={side}>
        {side === 'staged' ? 'Staged' : 'Unstaged'}
      </span>
    {/if}
    <FileIcon {path} class="ml-1" />
    <PathText
      {path}
      directory="after"
      class="flex-auto text-ui"
      nameClass="font-medium"
      directoryClass="text-small text-muted-foreground/55"
    />
    {#if lines !== null}
      <LineCount {lines} class="shrink-0" />
    {/if}
    {#if !history && commit === null}
      <HandsInFile {hands} />
    {/if}
    <span class="ml-1 flex shrink-0 items-center gap-px">
      {#if onStep !== undefined}
        <Tooltip text="Previous file" keys="K">
          <button type="button" class={ICON} aria-label="Previous file" onclick={() => onStep(-1)}><ChevronUp class="size-3.5" /></button>
        </Tooltip>
        <Tooltip text="Next file" keys="J">
          <button type="button" class={ICON} aria-label="Next file" onclick={() => onStep(1)}><ChevronDown class="size-3.5" /></button>
        </Tooltip>
      {/if}
      {#if !history}
        <DiffWidthSwitch
          width={reading.width}
          tooWide={reading.tooWide}
          said={reading.narrowSaid}
          onWidth={(next: DiffWidth) => marks.widths.set(DIFF_WIDTH, next)}
        />
      {/if}
      {#if onOpenFile !== undefined && commit === null && !reading.binary}
        <Tooltip text="Open the file at this change">
          <button
            type="button"
            class={ICON}
            aria-label="Open the file at this change"
            onclick={() => onOpenFile(diff?.seenLine() ?? null)}
            data-diff-open-file
          >
            <FileText class="size-3.5" />
          </button>
        </Tooltip>
      {/if}
      <Tooltip text="File history">
        <button
          type="button"
          class={[ICON, history && 'bg-selected text-foreground']}
          aria-label="File history"
          aria-pressed={history}
          onclick={flip}
        >
          <History class="size-3.5" />
        </button>
      </Tooltip>
      <ViewMenu />
      {#if closable}
        <Tooltip text="Close" keys={keymap.spell(keymap.bare('Escape'))}>
          <button type="button" class={ICON} aria-label="Close" onclick={onClose}><X class="size-3.5" /></button>
        </Tooltip>
      {/if}
    </span>
  </header>
  {#if history}
    <CommitHistory
      {projectId}
      {rootId}
      {path}
      onPick={(picked) => {
        historyAt = null;
        onCommit(picked);
      }}
    />
  {:else if reading.said !== undefined}
    <div class="p-4" data-diff-refused>
      <ReadingFailed failure={reading.failed} title="This file could not be read" onRetry={() => reading.refresh()} />
    </div>
  {:else if reading.answer === null}
    <div class="grid gap-2 p-4" aria-busy="true" data-diff-loading>
      {#each [72, 58, 84, 46, 66] as width, index (index)}
        <span class="block h-2 animate-pulse rounded-sm bg-selected" style:width="{width}%"></span>
      {/each}
    </div>
  {:else if reading.binary && isPicture(path)}
    {@const sides = reading.sides}
    <PictureDiff
      {projectId}
      {rootId}
      {path}
      before={sides.before === null ? null : { ...ends.before, path: sides.before }}
      after={sides.after === null ? null : { ...ends.after, path: sides.after }}
    />
  {:else if reading.binary}
    {@render stateOf(FileQuestion, 'Binary file', `git weighs no lines in ${path}, and it is no picture this pane draws.`, 'binary')}
  {:else if rows.length === 0 && !reading.timedOut}
    {#if reading.sides.before === null}
      {@render stateOf(FilePlus, 'Empty file added', `${path} holds no lines in ${ends.after.name}.`, 'added-empty')}
    {:else if reading.sides.after === null}
      {@render stateOf(FileMinus, 'Empty file deleted', `${path} held no lines in ${ends.before.name}.`, 'deleted-empty')}
    {:else}
      {@render stateOf(
        Equal,
        'Same text on both sides',
        `${ends.before.name} and ${ends.after.name} hold the same text of ${path}.`,
        'identical',
      )}
    {/if}
  {:else}
    <div class="flex min-h-0 flex-1 flex-col" data-diff-body>
      {#if reading.timedOut}
        <p class="shrink-0 border-b bg-hover px-2 py-1 text-small text-muted-foreground">
          The comparison could not finish, so these rows are aligned only in part.
        </p>
      {/if}
      <div class="min-h-0 flex-1 overflow-hidden">
        <Diff
          bind:this={diff}
          {rows}
          language={displayLanguage(path)}
          {wrap}
          onExpand={reading.width === 'patch' ? expand : undefined}
          onMark={(held) => void router.goto(addresses.thread(held.id))}
        />
      </div>
    </div>
  {/if}
</section>
