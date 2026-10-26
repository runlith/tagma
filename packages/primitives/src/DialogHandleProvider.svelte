<script lang="ts">
  import type { Snippet } from 'svelte';
  import { provideDialogHandle, type DialogHandleContext } from './dialog-handle-context.svelte.js';

  interface Props {
    context: DialogHandleContext;
    children: Snippet;
  }

  let { context, children }: Props = $props();

  provideDialogHandle({
    get handle() {
      return context.handle;
    },
    close: (result?: unknown) => context.close(result),
  });
</script>

{@render children?.()}
