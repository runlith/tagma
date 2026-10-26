<script lang="ts">
  import type { Component } from 'svelte';

  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';

  import DialogContent from './dialog/content.svelte';
  import DialogOverlay from './dialog/overlay.svelte';
  import Dialog from './dialog/root.svelte';
  import DialogHandleProvider from './DialogHandleProvider.svelte';
  import { Dialogs } from './DialogRegistry.svelte.js';
  import Portal from './Portal.svelte';
  import type { DialogMotion } from './types.js';

  interface Props {
    overlayClass?: string;
    contentClass?: string;
    motion?: DialogMotion;
  }

  let { overlayClass, contentClass, motion }: Props = $props();

  const dialogs = Dialogs.use();
</script>

{#each dialogs.stack as entry (entry.id)}
  <Dialog
    bind:open={entry.open}
    interactOutsideBehavior={entry.resolvedInteractOutsideBehavior}
    escapeKeydownBehavior={entry.resolvedEscapeKeydownBehavior}
    onEscapeIgnored={entry.onEscapeIgnored}
    motion={entry.motion ?? motion}
    overlayKey={entry.key}
  >
    <Portal>
      {#if entry.scrim}
        <DialogOverlay class={entry.overlayClass ?? overlayClass} style="position:fixed;inset:0;" />
      {/if}

      <DialogContent
        onPresent={() => dialogs.markPresented(entry.handle)}
        onCloseComplete={() => {
          if (entry.open) return;
          dialogs.finalizeClose(entry.handle);
        }}
        class={contentClass}
        style="position:fixed;inset:0;pointer-events:none;outline:none;"
      >
        <div style="pointer-events:auto;">
          <DialogHandleProvider context={{ handle: entry.handle, close: entry.handle.close }}>
            {@const DialogComponent = entry.component as Component}
            <ErrorBoundary id={`overlay:${entry.key ?? entry.id}`}>
              <DialogComponent {...entry.props} />
            </ErrorBoundary>
          </DialogHandleProvider>
        </div>
      </DialogContent>
    </Portal>
  </Dialog>
{/each}
