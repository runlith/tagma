<script lang="ts">
  import { readableOutput } from '../activity';
  import { clipFade } from '../clipFade';
  import type { ChatAttachment } from '../entries';
  import type { ChatEntryContext, ChatEntryOf } from '../renderers';
  import { useChatRendering } from '../renderers';
  import { patchBodyHeight } from '../rowEstimate';
  import { useChatStrings } from '../strings';
  import AttachmentStrip from './AttachmentStrip.svelte';
  import ClampedText from './ClampedText.svelte';
  import ToolDiff from './ToolDiff.svelte';

  let { entry, context }: { entry: ChatEntryOf<'tool'>; context?: ChatEntryContext } = $props();

  const rendering = useChatRendering();
  const strings = useChatStrings();

  const display = $derived(entry.display);

  const BLOCK = 'max-h-96 overflow-auto rounded-lg border border-border/60 bg-background/60';
  const MONO = 'font-mono text-small leading-5';

  const interrupted = $derived.by(() => {
    const raw = entry.toolInputRaw;
    if (!raw) return null;
    const size = raw.kind === 'text' ? raw.text.length : raw.byteLength;
    const where = raw.kind === 'retained' ? (raw.location ?? raw.outputId) : raw.kind === 'unavailable' ? raw.reason : null;
    return { size, where, complete: raw.complete };
  });

  const listOverflow = $derived(
    display?.form === 'list' && display.total !== undefined && display.total > display.items.length
      ? display.total - display.items.length
      : 0,
  );

  const readable = $derived(readableOutput(entry, (name, output) => rendering.kinds.toolModelText(name, output)));

  const pictures = $derived<readonly ChatAttachment[]>(
    (display?.images ?? []).map((image) => ({
      mime: image.mediaType,
      url: image.url,
      filename: image.label,
    })),
  );
</script>

<div class="grid min-w-0 gap-2">
  {#if interrupted}
    <div class={[MONO, 'flex min-w-0 gap-x-3 text-muted-foreground/60']}>
      <span class="shrink-0">{strings.interrupted()}</span>
      <span class="shrink-0">{strings.characters(interrupted.size)}</span>
      {#if interrupted.where}<span class="min-w-0" data-fade {@attach clipFade}>{interrupted.where}</span>{/if}
    </div>
  {/if}
  {#if display?.form === 'message' && display.text}
    <div class="border-l-2 border-border/60 pl-3">
      {@render rendering.markdown({ cacheKey: entry.id, class: 'text-foreground/90', text: display.text })}
    </div>
  {:else if display?.form === 'code' && display.text}
    {@render rendering.code({
      cacheKey: entry.id,
      text: display.text,
      ...(display.language ? { language: display.language } : {}),
      ...(display.firstLine === undefined ? {} : { firstLine: display.firstLine }),
    })}
  {:else if display?.form === 'command'}
    <div class="grid gap-2">
      <ClampedText text={display.command} id={`${entry.id}:command`} code />
      {#if display.output}
        <pre class={[BLOCK, MONO, 'p-3 whitespace-pre-wrap text-muted-foreground']}>{display.output}</pre>
      {/if}
    </div>
  {:else if display?.form === 'diff'}
    {#each display.files as file, index (index)}
      {#if file.patch}
        <div class={[BLOCK, 'flex']} style={`height:${patchBodyHeight(file.patch)}px`}>
          <ToolDiff
            patch={file.patch}
            path={file.path}
            language={file.language}
            highlight={rendering.highlight}
            timedOut={file.timedOut === true}
          />
        </div>
      {/if}
    {/each}
  {:else if display?.form === 'list' && display.items.length > 0}
    <ul class={[BLOCK, 'grid gap-0.5 px-3 py-2']}>
      {#each display.items as item, index (index)}
        <li class="flex min-w-0 items-baseline gap-2">
          <span class={[MONO, 'shrink-0 text-muted-foreground']}>{item.label}</span>
          {#if item.detail}
            <span class={[MONO, 'min-w-0 flex-1 text-muted-foreground/50']} data-fade {@attach clipFade}>{item.detail}</span>
          {/if}
        </li>
      {/each}
      {#if listOverflow > 0}
        <li class="pt-1 text-small text-muted-foreground/50">{strings.andMore(listOverflow)}</li>
      {/if}
    </ul>
  {:else if display?.form === 'markdown' && display.text}
    <div class={[BLOCK, 'px-3 py-2']}>
      {@render rendering.markdown({ cacheKey: entry.id, text: display.text })}
    </div>
  {:else if display?.form === 'text' && display.text}
    <pre class={[BLOCK, MONO, 'p-3 whitespace-pre-wrap text-muted-foreground']}>{display.text}</pre>
  {:else if readable !== null}
    <pre class={[BLOCK, MONO, 'p-3 whitespace-pre-wrap text-muted-foreground']}>{readable}</pre>
  {/if}
  {#if pictures.length > 0}
    <AttachmentStrip entryId={entry.id} attachments={pictures} {context} align="start" />
  {/if}
</div>
