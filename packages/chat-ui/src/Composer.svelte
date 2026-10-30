<script lang="ts">
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
  import ListEnd from '@lucide/svelte/icons/list-end';
  import Plus from '@lucide/svelte/icons/plus';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import { tick, untrack } from 'svelte';
  import type { ComposerCommandArgs, ComposerGesture, ComposerHandler } from './composer';
  import type { ComposerContributions } from './ComposerContributions.svelte';
  import { ComposerMenu, type ComposerPick } from './ComposerMenu.svelte';
  import { composerIntent, rewindEscape } from './composerKeys';
  import ComposerFrame from './ComposerFrame.svelte';
  import { COMPOSER_ACTION_GROUP_CLASS, COMPOSER_STATUS_GROUP_CLASS, COMPOSER_STRIP_CLASS } from './composerFrame';
  import ComposerMenuPopup from './ComposerMenuPopup.svelte';
  import { pastedFiles } from './fileIntake.svelte';
  import type { PromptRecall } from './PromptHistory';
  import PromptField from './PromptField.svelte';
  import type { PromptHandle } from './PromptHandle.svelte';
  import { useChatRendering } from './renderers';
  import { type ChatRewindChip, type ChatRewindTarget, pickerIntent } from './rewind';
  import RewindPicker from './RewindPicker.svelte';
  import type { ChatHalt } from './session/TurnCommands.svelte';
  import { useChatStrings } from './strings';
  import Waiting from './Waiting.svelte';

  type Props = {
    contributions: ComposerContributions;
    handle: PromptHandle;
    canSend: boolean;
    draft: string;
    placeholder: string;
    running?: boolean;
    halt?: ChatHalt | null;
    sending?: boolean;
    steerable?: boolean;
    onDraft(value: string): void;
    onSend(): boolean | void | Promise<boolean> | Promise<void>;
    onStop?(): void;
    onQueue?(): boolean | void | Promise<boolean> | Promise<void>;
    onTakeWaiting?(): void;
    perform(handler: ComposerHandler): void;
    history?: PromptRecall;
    rewindTargets?: readonly ChatRewindTarget[];
    rewindChip?: ChatRewindChip | null;
  };

  let {
    contributions,
    handle,
    canSend,
    draft,
    placeholder,
    running = false,
    halt = null,
    sending = false,
    steerable = true,
    onDraft,
    onSend,
    onStop,
    onQueue,
    onTakeWaiting,
    perform,
    history,
    rewindTargets = [],
    rewindChip = null,
  }: Props = $props();

  const DOUBLE_ESCAPE_MS = 600;

  const strings = useChatStrings();
  const rendering = useChatRendering();
  const touch = rendering.touch;
  const button = rendering.button;
  let pickedRun = $state<string | null>(null);
  let escapedAt: number | null = null;
  let chipSeen: string | null = null;
  const rewind = $derived(rendering.rewind);
  const pickable = $derived(rewind === undefined ? [] : rewindTargets.filter((target) => target.rewound === undefined));
  const picking = $derived.by(() => {
    if (pickedRun === null) return null;
    const index = pickable.findIndex((target) => target.runId === pickedRun);
    return index < 0 ? null : index;
  });

  $effect(() => {
    const rewound = rewindChip?.rewindId ?? null;
    if (rewound === chipSeen) return;
    chipSeen = rewound;
    if (rewound !== null) untrack(() => focusAtEnd());
  });

  function focusAtEnd(): void {
    void tick().then(() => {
      field?.focus();
      field?.caret(draft.length);
    });
  }

  function heldAt(index: number): boolean {
    const target = pickable[index];
    if (target === undefined) return true;
    const point = rewind?.point(target.runId);
    return point !== undefined && !point.rewindable;
  }

  function openPicker(): void {
    let index = pickable.length - 1;
    while (index >= 0 && heldAt(index)) index -= 1;
    if (index < 0) return;
    menu.hide();
    pickedRun = pickable[index]!.runId;
  }

  function movePicker(step: 1 | -1): void {
    if (picking === null) return;
    for (let index = picking + step; index >= 0 && index < pickable.length; index += step) {
      if (heldAt(index)) continue;
      pickedRun = pickable[index]!.runId;
      return;
    }
  }

  function pick(index: number, act: 'rewind' | 'branch'): void {
    const target = pickable[index];
    pickedRun = null;
    if (target === undefined || rewind === undefined) return;
    if (act === 'branch') rewind.branch(target.runId);
    else if (!heldAt(index)) void rewind.rewind(target.runId, 'from');
  }

  function editLast(): void {
    const index = pickable.length - 1;
    if (index >= 0 && !heldAt(index)) pick(index, 'rewind');
  }

  export function dismiss(): boolean {
    if (picking !== null) {
      pickedRun = null;
      field?.focus();
      return true;
    }
    if (menu.kind === null) return false;
    menu.back();
    field?.focus();
    return true;
  }

  export function escapeToRewind(): boolean {
    const armed = escapedAt !== null && performance.now() - escapedAt < DOUBLE_ESCAPE_MS;
    const intent = rewindEscape({
      rewinds: pickable.length > 0 && contributions.shownPanel === null,
      empty: draft.length === 0,
      browsing: historyIndex !== null,
      armed,
    });
    escapedAt = intent === 'arm' ? performance.now() : null;
    if (intent === 'pick') openPicker();
    return intent !== 'none';
  }
  const menuId = $props.id();
  const pickerId = `${menuId}-rewind`;
  const menu = new ComposerMenu(() => ({ commands: contributions.commands, providers: contributions.mentions }));
  let field: ReturnType<typeof PromptField> | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let popupElement: HTMLDivElement | undefined = $state();
  let caretAtStart = $state(true);
  let caretAtEnd = $state(true);
  let historyIndex = $state<number | null>(null);
  let recalling = false;
  const canSubmit = $derived(canSend);
  const submitTitle = $derived(canSend ? (running ? strings.steerTurn() : strings.send()) : strings.typeMessageToSend());
  const steering = $derived(running && steerable && onQueue !== undefined);
  const hinting = $derived(steering && !touch);
  const shownPlaceholder = $derived(hinting ? strings.runningPlaceholder() : placeholder);
  const stopLabel = $derived(
    halt === null || onStop === undefined
      ? null
      : halt === 'stop'
        ? strings.stop()
        : halt === 'stopping'
          ? strings.stopping()
          : strings.beingStopped(),
  );
  const sendChoices = $derived(
    steering && canSend
      ? [
          { label: strings.sendAtNextStep(), icon: CornerDownLeft, key: touch ? undefined : 'Enter', onSelect: () => void onSend() },
          { label: strings.sendAfterTurn(), icon: ListEnd, key: touch ? undefined : 'Tab', onSelect: () => void onQueue?.() },
        ]
      : undefined,
  );
  const activeId = $derived(menu.options.length ? `${menuId}-${menu.active}` : undefined);
  const mentionQuery = $derived(menu.kind === 'mention' ? menu.query : null);
  const marking = $derived(contributions.mentions.filter((provider) => provider.marks !== undefined));
  const marks = $derived(
    marking.length === 0 ? null : (text: string) => marking.flatMap((provider) => provider.marks!(text)).sort((a, b) => a.from - b.from),
  );
  const leading = $derived(contributions.chips('leading'));
  const status = $derived(contributions.chips('status'));
  const trailing = $derived(contributions.chips('right'));
  const media = $derived(contributions.chips('media'));
  const edge = $derived(contributions.chips('edge'));
  const strip = $derived(contributions.chips('strip'));

  $effect(() => {
    const opened = menu.kind === 'mention' ? menu.provider?.id : undefined;
    if (opened === undefined) return;
    untrack(() => {
      const open = menu.provider?.opened;
      if (open) perform(open());
    });
  });

  $effect(() => {
    const query = mentionQuery;
    if (query === null) return;
    untrack(() => {
      const search = menu.provider?.search;
      if (search) perform(search(query));
    });
  });

  $effect(() => {
    const editor = field;
    if (editor === undefined) return;
    return handle.attach({
      selection: () => editor.selection(),
      write: (from, to, text, caret) => editor.write(from, to, text, caret),
      caret: (offset) => editor.caret(offset),
      focus: () => {
        menu.hide();
        history?.leave();
        historyIndex = null;
        if (!touch) editor.focus();
      },
    });
  });

  $effect(() => {
    menu.options;
    menu.reconcile();
  });

  function run(name: string, args: ComposerCommandArgs): void {
    const command = contributions.commands.find((one) => one.name === name);
    if (command && !command.disabled) perform(command.run(args));
  }

  function apply(pick: ComposerPick | null, gesture: ComposerGesture = 'send'): void {
    if (!pick) return;
    if (pick.kind === 'mention') {
      const provider = contributions.mentions.find((one) => one.id === pick.provider);
      if (!provider) return;
      const insertion = provider.insertion?.(pick.id, draft.slice(pick.to)) ?? { text: '', skip: 0 };
      const position = field?.replace(pick.from, pick.to, insertion.text, insertion.skip);
      if (!position) return;
      menu.dismiss(position);
      if (provider.pick) perform(provider.pick(pick.id));
      return;
    }
    menu.dismiss({ text: '', from: 0, to: 0 });
    edit('');
    if (pick.kind === 'command') {
      run(pick.name, { gesture, optionId: pick.optionId });
    } else if (pick.kind === 'form') run(pick.command.name, { gesture, values: pick.values });
    else if (pick.kind === 'open') {
      field?.clear();
      run(pick.command.name, { gesture, query: pick.query });
    }
  }

  const panelDoor = { returnFocus: () => field?.focus() };

  function edit(value: string): void {
    pickedRun = null;
    const opening = recalling ? null : menu.opening(value);
    if (opening) {
      apply(opening);
      return;
    }
    if (!recalling) {
      history?.edited();
      historyIndex = null;
    }
    onDraft(value);
  }

  function recall(text: string | null, at: 'start' | 'end'): void {
    historyIndex = history?.index ?? null;
    const target = field;
    if (text === null || !target) return;
    recalling = true;
    try {
      if (!target.replace(0, draft.length, text)) return;
      target.caret(at === 'start' ? 0 : text.length);
    } finally {
      recalling = false;
    }
  }

  function pressPicker(event: KeyboardEvent, index: number): void {
    const intent = pickerIntent(event);
    if (intent === 'none') return;
    event.preventDefault();
    switch (intent) {
      case 'next':
        movePicker(1);
        break;
      case 'previous':
        movePicker(-1);
        break;
      case 'close':
        pickedRun = null;
        break;
      case 'rewind':
        pick(index, 'rewind');
        break;
      case 'branch':
        pick(index, 'branch');
        break;
    }
  }

  function press(event: KeyboardEvent): void {
    if (picking !== null) {
      pressPicker(event, picking);
      return;
    }
    const intent = composerIntent(event, {
      canSend,
      running,
      menuOpen: menu.kind !== null,
      menuQueues: menu.kind === 'slash',
      cyclesMode: contributions.cycler !== null,
      caretAtStart,
      caretAtEnd,
      browsing: historyIndex !== null,
      hasHistory: Boolean(history),
      empty: draft.length === 0,
      rewinds: pickable.length > 0 && contributions.shownPanel === null,
      touch,
      waiting: onTakeWaiting !== undefined,
    });
    if (event.key !== 'Escape' || intent !== 'none') escapedAt = null;
    if (intent === 'none' || intent === 'newline') return;
    event.preventDefault();
    switch (intent) {
      case 'edit-last':
        editLast();
        break;
      case 'take-waiting':
        onTakeWaiting?.();
        break;
      case 'menu-next':
        menu.move(1);
        break;
      case 'menu-previous':
        menu.move(-1);
        break;
      case 'menu-pick':
        apply(menu.pick());
        break;
      case 'menu-queue':
        apply(menu.pick(), 'queue');
        break;
      case 'menu-back':
        menu.back();
        break;
      case 'cycle-mode': {
        const cycle = contributions.cycler?.cycle;
        if (cycle) perform(cycle.run());
        break;
      }
      case 'queue':
        if (running && onQueue) void onQueue();
        else void onSend();
        break;
      case 'send':
        void onSend();
        break;
      case 'history-previous':
        recall(history?.previous(draft) ?? null, 'start');
        break;
      case 'history-next':
        recall(history?.next() ?? null, 'end');
        break;
      case 'history-leave':
        recall(history?.leave() ?? null, 'end');
        break;
    }
  }

  function paste(event: ClipboardEvent): void {
    if (contributions.attachments.length === 0 || !event.clipboardData) return;
    const files = pastedFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    perform(contributions.intake(files));
  }

  function attach(event: Event): void {
    const picker = event.currentTarget as HTMLInputElement;
    const files = picker.files ? Array.from(picker.files) : [];
    if (files.length > 0) perform(contributions.intake(files));
    picker.value = '';
  }
</script>

{#snippet draftField()}
  <PromptField
    bind:this={field}
    {draft}
    placeholder={shownPlaceholder}
    hint={hinting ? runningHint : null}
    {marks}
    ghost={handle.ghost}
    onEdit={handle.tracking ? (edit) => handle.edited(edit) : undefined}
    menuId={picking === null ? menuId : pickerId}
    activeId={picking === null ? activeId : `${pickerId}-${picking}`}
    menuOpen={menu.kind !== null || picking !== null}
    onDraft={edit}
    onSelection={(position) => {
      menu.update(position);
      caretAtStart = position.from === 0 && position.to === 0;
      caretAtEnd = position.from === position.text.length && position.to === position.text.length;
    }}
    onKeydown={press}
    onPaste={paste}
    onBlur={(target) => {
      if (target instanceof Node && popupElement?.contains(target)) return;
      menu.hide();
      pickedRun = null;
    }}
  />
{/snippet}

{#snippet runningHint()}
  {@render rendering.key({ code: 'Enter', size: 'sm' })}{strings.hintNextStep()}<span class="ml-2 flex items-center gap-1.5"
    >{@render rendering.key({ code: 'Tab', size: 'sm' })}{strings.hintAfterTurn()}</span
  >
{/snippet}

{#snippet attachIcon()}<Plus class="size-4" />{/snippet}
{#snippet stopIcon()}<Square class="size-3.5 fill-current" />{/snippet}
{#snippet submitIcon()}
  {#if sending}<Waiting class="size-4" />{:else if steering}<CornerDownLeft class="size-4" />{:else}<ArrowUp class="size-4" />{/if}
{/snippet}

{#snippet mediaZone()}
  {#each media as chip (chip.id)}
    {@render chip.body()}
  {/each}
{/snippet}

{#snippet leftZone()}
  {#if contributions.attachButton}
    {@render button({
      control: 'attach',
      type: 'button',
      label: strings.attachFiles(),
      icon: attachIcon,
      onclick: () => fileInput?.click(),
    })}
  {/if}
  {#each leading as chip (chip.id)}
    {@render chip.body()}
  {/each}
  {#if rewindChip !== null && rewind !== undefined}
    {@const chip = rewindChip}
    <span
      class="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-dashed border-primary/50 pr-0.5 pl-2 text-small font-medium whitespace-nowrap text-primary @min-[30rem]:h-8 @min-[30rem]:text-small"
    >
      <span>↶ {rewind.words.rewoundTo(chip.ordinal)}</span>
      <button
        type="button"
        class="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full transition hover:bg-hover disabled:cursor-default disabled:opacity-40"
        title={rewind.words.restore()}
        aria-label={rewind.words.restore()}
        disabled={rewind.busy}
        onclick={() => rewind.restore(chip.rewindId)}
      >
        <X class="size-3" />
      </button>
    </span>
  {/if}
{/snippet}

{#snippet edgeZone()}
  {#each edge as chip (chip.id)}
    {@render chip.body()}
  {/each}
{/snippet}

{#snippet rightZone()}
  {#if status.length > 0}
    <div class={COMPOSER_STATUS_GROUP_CLASS}>
      {#each status as chip (chip.id)}
        {@render chip.body()}
      {/each}
    </div>
  {/if}
  {#if trailing.length > 0}
    <div class={COMPOSER_ACTION_GROUP_CLASS}>
      {#each trailing as chip (chip.id)}
        {@render chip.body()}
      {/each}
    </div>
  {/if}
  <div class={COMPOSER_ACTION_GROUP_CLASS}>
    {#if stopLabel !== null}
      {@render button({ control: 'stop', quiet: canSend, type: 'button', label: stopLabel, icon: stopIcon, onclick: onStop })}
    {/if}
    {#if stopLabel === null || canSend}
      {@render button({
        control: 'submit',
        type: 'submit',
        label: submitTitle,
        disabled: !canSubmit,
        icon: submitIcon,
        choices: sendChoices,
        choicesLabel: strings.whenToSend(),
        choiceFocus: () => (touch ? null : (field?.element() ?? null)),
      })}
    {/if}
  </div>
{/snippet}

<form
  class="relative min-w-0"
  onsubmit={(event) => {
    event.preventDefault();
    if (canSubmit) void onSend();
  }}
>
  {#if contributions.shownPanel}
    <div
      data-composer-popup
      class="absolute inset-x-0 bottom-full z-50 mb-2 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-raised"
    >
      {@render contributions.shownPanel.body(panelDoor)}
    </div>
  {:else if picking !== null && rewind !== undefined}
    {@const index = picking}
    <div
      bind:this={popupElement}
      data-composer-popup
      class="absolute inset-x-0 bottom-full z-50 mb-2 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-raised"
    >
      <RewindPicker
        id={pickerId}
        targets={pickable}
        active={index}
        {rewind}
        onHover={(at) => (pickedRun = pickable[at]?.runId ?? null)}
        onPick={(at) => pick(at, 'rewind')}
      />
    </div>
  {:else if menu.kind !== null}
    <ComposerMenuPopup
      {menu}
      {menuId}
      bind:element={popupElement}
      onApply={(pick) => apply(pick)}
      onBack={() => {
        menu.back();
        field?.focus();
      }}
    />
  {/if}
  <ComposerFrame
    alert={handle.alert}
    drop={contributions.dropState}
    media={media.length > 0 ? mediaZone : undefined}
    edge={edge.length > 0 ? edgeZone : undefined}
    input={draftField}
    leftActions={leftZone}
    rightActions={rightZone}
  />
  {#if strip.length > 0}
    <div class={COMPOSER_STRIP_CLASS} data-composer-strip>
      {#each strip as chip (chip.id)}
        {@render chip.body()}
      {/each}
    </div>
  {/if}
  {#if contributions.attachments.length > 0}
    <input bind:this={fileInput} type="file" accept={contributions.attachAccept} multiple class="hidden" onchange={attach} />
  {/if}
</form>
