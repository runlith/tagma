<script lang="ts">
  import { displayDraws, readableOutput } from '../activity';
  import { clipFade } from '../clipFade';
  import type { ChatAttachment } from '../entries';
  import type { ChatEntryContext, ChatEntryOf } from '../renderers';
  import { useChatRendering } from '../renderers';
  import { patchBodyHeight } from '../rowEstimate';
  import { useChatStrings } from '../strings';
  import type { ChatLink } from '../surface';
  import AttachmentStrip from './AttachmentStrip.svelte';
  import ToolDiff from './ToolDiff.svelte';
  import Well from './Well.svelte';

  let { entry, context }: { entry: ChatEntryOf<'tool'>; context?: ChatEntryContext } = $props();

  const rendering = useChatRendering();
  const strings = useChatStrings();

  const display = $derived(entry.display);

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

  const file = $derived<ChatLink | null>(
    rendering.navigation.files && display?.form === 'code' && display.path !== undefined
      ? { kind: 'file', path: display.path, line: display.firstLine }
      : null,
  );

  const pictures = $derived<readonly ChatAttachment[]>(
    (display?.images ?? []).map((image) => ({
      mime: image.mediaType,
      url: image.url,
      filename: image.label,
    })),
  );

  const lineCount = (text: string): string => strings.lineCount(text.split('\n').length);

  const nameAt = (label: string): number => label.lastIndexOf('/', label.length - 2) + 1;
</script>

<div class="grid min-w-0 gap-2">
  {#if interrupted}
    <div class="flex min-w-0 gap-x-3 font-mono text-small leading-5 text-muted-foreground/60">
      <span class="shrink-0">{strings.interrupted()}</span>
      <span class="shrink-0">{strings.characters(interrupted.size)}</span>
      {#if interrupted.where}<span class="min-w-0" data-fade {@attach clipFade}>{interrupted.where}</span>{/if}
    </div>
  {/if}
  {#if displayDraws(display)}
    {#if display.form === 'message'}
      <div class="min-w-0 leading-5">
        {@render rendering.markdown({ cacheKey: entry.id, size: 'ui', class: 'text-foreground/85', text: display.text })}
      </div>
    {:else if display.form === 'code'}
      <Well id={entry.id} copy={display.text} open={file} count={lineCount(display.text)}>
        {@render rendering.code({
          cacheKey: entry.id,
          text: display.text,
          ...(display.language ? { language: display.language } : {}),
          ...(display.firstLine === undefined ? {} : { firstLine: display.firstLine }),
        })}
      </Well>
    {:else if display.form === 'command'}
      <Well
        id={entry.id}
        copy={display.output ? `${display.command}\n${display.output}` : display.command}
        count={display.output ? lineCount(display.output) : null}
      >
        <pre
          class="min-w-0 font-mono text-small leading-5 whitespace-pre-wrap break-words text-foreground select-text">{display.command}</pre>
        {#if display.output}
          <pre
            class="mt-1 min-w-0 font-mono text-small leading-5 whitespace-pre-wrap break-words text-muted-foreground select-text">{display.output}</pre>
        {/if}
      </Well>
    {:else if display.form === 'diff'}
      {#each display.files as patched, index (index)}
        {#if patched.patch}
          <div class="flex min-w-0 overflow-hidden rounded-lg bg-chat-sunken py-1" style={`height:${patchBodyHeight(patched.patch)}px`}>
            <ToolDiff
              patch={patched.patch}
              path={patched.path}
              language={patched.language}
              highlight={rendering.highlight}
              timedOut={patched.timedOut === true}
            />
          </div>
        {/if}
      {/each}
    {:else if display.form === 'list'}
      <Well
        id={entry.id}
        copy={display.items.map((item) => (item.detail ? `${item.label}  ${item.detail}` : item.label)).join('\n')}
        count={display.total === undefined ? null : String(display.total)}
      >
        <ul class="grid min-w-0">
          {#each display.items as item, index (index)}
            {@const at = nameAt(item.label)}
            <li class="flex h-6 min-w-0 items-baseline gap-2 font-mono text-small leading-6">
              <span class="flex min-w-0 items-baseline">
                {#if at > 0}<span class="min-w-0 text-muted-foreground" data-fade="start" {@attach clipFade}
                    ><bdi>{item.label.slice(0, at)}</bdi></span
                  >{/if}<span class="max-w-full shrink-0 text-foreground/80" data-fade {@attach clipFade}>{item.label.slice(at)}</span>
              </span>
              {#if item.detail}
                <span class="min-w-0 flex-1 text-muted-foreground" data-fade {@attach clipFade}>{item.detail}</span>
              {/if}
            </li>
          {/each}
          {#if listOverflow > 0}
            <li class="h-6 font-sans text-small leading-6 text-muted-foreground/60">{strings.andMore(listOverflow)}</li>
          {/if}
        </ul>
      </Well>
    {:else if display.form === 'markdown'}
      <Well id={entry.id} copy={display.text} count={strings.characters(display.text.length)}>
        {@render rendering.markdown({ cacheKey: entry.id, size: 'small', class: 'text-muted-foreground', text: display.text })}
      </Well>
    {:else if display.form === 'text'}
      <Well id={entry.id} text={display.text} />
    {/if}
  {:else if readable !== null}
    <Well id={entry.id} text={readable} />
  {/if}
  {#if pictures.length > 0}
    <AttachmentStrip entryId={entry.id} attachments={pictures} {context} align="start" />
  {/if}
</div>
