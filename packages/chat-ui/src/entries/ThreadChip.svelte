<script lang="ts">
  import { type ChatActivityIdentity, useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';

  let { thread }: { thread: ChatActivityIdentity['threads'][number] } = $props();

  const rendering = useChatRendering();
  const strings = useChatStrings();
</script>

<button
  type="button"
  class="inline-flex shrink-0 cursor-pointer items-center rounded-md bg-hover px-1.5 text-small leading-5 whitespace-nowrap text-foreground/90 transition hover:bg-selected"
  aria-label={`${strings.openThread()}: ${thread.title}`}
  {@attach rendering.navigation.link({ kind: 'thread', threadId: thread.id, projectId: thread.projectId })}>{thread.title}</button
>
