<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';

  import type { DialogMotion, EscapeKeydownBehavior, InteractOutsideBehavior } from '../types.js';
  import { Dialogs } from '../DialogRegistry.svelte.js';
  import { OverlayLayer } from '../layer.svelte.js';
  import { provideDialogRootContext } from './context.svelte.js';
  import { resolveDialogMotion } from './motion.js';
  import { lockDialogScroll } from './scroll-lock.js';

  interface Props {
    open?: boolean;
    interactOutsideBehavior?: InteractOutsideBehavior;
    escapeKeydownBehavior?: EscapeKeydownBehavior;
    motion?: DialogMotion;
    overlayKey?: string;
    onOpenChange?: (open: boolean) => void;
    onEscapeIgnored?: () => void;
    children: Snippet;
  }

  let {
    open = $bindable(false),
    interactOutsideBehavior = 'close',
    escapeKeydownBehavior = 'close',
    motion,
    overlayKey,
    onOpenChange,
    onEscapeIgnored,
    children,
  }: Props = $props();

  let contentEl = $state<HTMLElement | null>(null);
  let titleId = $state<string | undefined>(undefined);
  let descriptionId = $state<string | undefined>(undefined);
  let ready = $state(false);
  const dialogs = Dialogs.use();
  const rootId = Symbol('dialog-root');
  const resolvedMotion = $derived.by(() => resolveDialogMotion(motion));
  const present = $derived(open && ready);

  const setOpen = (next: boolean): void => {
    if (open === next) return;
    open = next;
    onOpenChange?.(next);
  };

  const layer = OverlayLayer.make(
    (reason) => {
      if (reason === 'escape' && escapeKeydownBehavior === 'ignore') return onEscapeIgnored?.();
      layer.close(reason);
      setOpen(false);
    },
    { modal: true },
  );

  $effect.pre(() => {
    if (open) untrack(() => layer.open());
    else untrack(() => layer.close());
  });

  $effect.pre(() => {
    dialogs.trackRoot(rootId, contentEl !== null, overlayKey);
  });

  onDestroy(() => {
    dialogs.untrackRoot(rootId);
  });

  $effect(() => {
    if (ready) return;
    queueMicrotask(() => {
      ready = true;
    });
  });

  provideDialogRootContext({
    get open() {
      return open;
    },
    get present() {
      return present;
    },
    layer,
    setOpen,
    get contentEl() {
      return contentEl;
    },
    setContentEl(el) {
      contentEl = el;
    },
    get titleId() {
      return titleId;
    },
    setTitleId(id) {
      titleId = id;
    },
    get descriptionId() {
      return descriptionId;
    },
    setDescriptionId(id) {
      descriptionId = id;
    },
    get interactOutsideBehavior() {
      return interactOutsideBehavior;
    },
    get motion() {
      return resolvedMotion;
    },
  });

  $effect(() => {
    if (!contentEl) return;
    return lockDialogScroll();
  });
</script>

{@render children?.()}
