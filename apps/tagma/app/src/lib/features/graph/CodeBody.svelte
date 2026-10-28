<script lang="ts">
  import { highlightCode, plainCodeHtml } from '@runlith/highlight/colours';

  let {
    text,
    language,
    firstLine,
    class: className = '',
  }: {
    text: string;
    language?: string;
    firstLine?: number;
    class?: string;
  } = $props();

  let html = $state('');
  let renderRevision = 0;

  $effect(() => {
    const source = text;
    const lang = language;
    const revision = ++renderRevision;
    if (!html) html = plainCodeHtml(source, lang);
    void (async () => {
      const next = await highlightCode(source, lang);
      if (revision !== renderRevision) return;
      html = next;
    })();
  });
</script>

<div
  class={['code-body overflow-x-auto', className]}
  data-gutter={firstLine === undefined ? undefined : ''}
  style={firstLine === undefined ? undefined : `--code-first-line:${firstLine - 1}`}
>
  {@html html}
</div>

<style>
  .code-body :global(pre) {
    margin: 0;
    padding: 0;
    background: transparent !important;
    font-size: var(--text-small);
    line-height: 1.25rem;
  }

  .code-body :global(code) {
    display: block;
    font-family: var(--font-mono);
  }

  .code-body[data-gutter] :global(code) {
    counter-reset: code-line var(--code-first-line);
  }

  .code-body[data-gutter] :global(.line) {
    counter-increment: code-line;
  }

  .code-body[data-gutter] :global(.line::before) {
    content: counter(code-line);
    display: inline-block;
    width: 2.5rem;
    margin-right: calc(var(--spacing) * 3);
    color: color-mix(in oklch, var(--muted-foreground), transparent 55%);
    text-align: right;
    user-select: none;
  }
</style>
