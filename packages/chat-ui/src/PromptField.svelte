<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { clipFade } from './clipFade';
  import type { ComposerMark, PromptSelection } from './composer';
  import { COMPOSER_INPUT_CLASS } from './composerFrame';
  import { editOf, type PromptEdit } from './promptEdit';
  import type { PromptGhost } from './PromptHandle.svelte';

  type Props = {
    draft: string;
    placeholder: string;
    hint?: Snippet | null;
    marks?: ((text: string) => readonly ComposerMark[]) | null;
    ghost?: PromptGhost | null;
    menuId: string;
    activeId?: string;
    menuOpen: boolean;
    onDraft(value: string): void;
    onSelection(position: PromptSelection): void;
    onKeydown(event: KeyboardEvent): void;
    onPaste(event: ClipboardEvent): void;
    onBlur(target: EventTarget | null): void;
    onEdit?(edit: PromptEdit | null): void;
  };

  let {
    draft,
    placeholder,
    hint = null,
    marks = null,
    ghost = null,
    menuId,
    activeId,
    menuOpen,
    onDraft,
    onSelection,
    onKeydown,
    onPaste,
    onBlur,
    onEdit,
  }: Props = $props();
  let textarea: HTMLTextAreaElement | undefined = $state();
  let mirror: HTMLDivElement | undefined = $state();
  let composing = false;
  let pending: { readonly from: number; readonly to: number; readonly text: string; readonly known: boolean } | null = null;
  let own = false;

  const UNTRACKED = /^history|Drop$|Drag$/;

  function before(event: InputEvent): void {
    if (!textarea || onEdit === undefined) return;
    pending = { from: textarea.selectionStart, to: textarea.selectionEnd, text: textarea.value, known: !UNTRACKED.test(event.inputType) };
  }

  function input(): void {
    if (!textarea) return;
    if (onEdit !== undefined && !own) {
      const was = pending;
      onEdit(was === null || !was.known ? null : editOf(was.text, was.from, was.to, textarea.value, textarea.selectionStart));
    }
    pending = null;
    onDraft(textarea.value);
    fit();
    report();
  }
  type Segment = { readonly text: string; readonly kind: 'text' | 'mark' | 'ghost' };

  const marked = $derived(marks !== null);
  const haunting = $derived(ghost !== null && ghost.text !== '');
  const decorated = $derived(marked || haunting);
  const pieces = $derived<readonly Segment[]>(marked ? markedPieces(draft) : [{ text: draft, kind: 'text' }]);
  const segments = $derived(ghost !== null && haunting ? haunted(pieces, ghost) : pieces);

  function haunted(pieces: readonly Segment[], { at, text }: PromptGhost): Segment[] {
    const out: Segment[] = [];
    let offset = 0;
    let placed = false;
    for (const piece of pieces) {
      const end = offset + piece.text.length;
      if (!placed && piece.kind === 'text' && at <= end) {
        const cut = Math.max(0, at - offset);
        out.push({ text: piece.text.slice(0, cut), kind: 'text' }, { text, kind: 'ghost' }, { text: piece.text.slice(cut), kind: 'text' });
        placed = true;
      } else out.push(piece);
      offset = end;
    }
    if (!placed) out.push({ text, kind: 'ghost' });
    return out;
  }

  function markedPieces(text: string): Segment[] {
    const pieces: Segment[] = [];
    let end = 0;
    for (const mark of marks?.(text) ?? []) {
      pieces.push({ text: text.slice(end, mark.from), kind: 'text' });
      pieces.push({ text: text.slice(mark.from, mark.to), kind: 'mark' });
      end = mark.to;
    }
    pieces.push({ text: text.slice(end), kind: 'text' });
    return pieces;
  }

  export function selection(): PromptSelection | null {
    return textarea ? { text: textarea.value, from: textarea.selectionStart, to: textarea.selectionEnd } : null;
  }

  function report(): void {
    const position = selection();
    if (position && !composing && document.activeElement === textarea) onSelection(position);
  }

  function fit(): void {
    if (!textarea) return;
    textarea.style.height = 'auto';
    let height = textarea.scrollHeight;
    if (mirror && haunting) {
      mirror.style.width = `${textarea.clientWidth}px`;
      mirror.style.height = 'auto';
      height = Math.max(height, mirror.scrollHeight);
    }
    textarea.style.height = `${height}px`;
    pin();
  }

  function pin(): void {
    if (!textarea || !mirror) return;
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.height = `${textarea.clientHeight}px`;
    scroll();
  }

  function scroll(): void {
    if (!textarea || !mirror) return;
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  }

  export function focus(): void {
    textarea?.focus({ preventScroll: true });
  }

  export function element(): HTMLTextAreaElement | null {
    return textarea ?? null;
  }

  export function replace(from: number, to: number, text: string, advance = 0): PromptSelection | null {
    if (!textarea) return null;
    textarea.focus({ preventScroll: true });
    if (from === to && text === '') return selection();
    textarea.setSelectionRange(from, to);
    const done = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text);
    if (!done) return null;
    if (advance) textarea.setSelectionRange(textarea.selectionStart + advance, textarea.selectionStart + advance);
    fit();
    return selection();
  }

  export function write(from: number, to: number, text: string, caret: 'preserve' | 'end'): PromptSelection | null {
    if (!textarea) return null;
    textarea.setRangeText(text, from, to, caret);
    own = true;
    try {
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      own = false;
    }
    return selection();
  }

  export function clear(): void {
    if (!textarea || textarea.value === '') return;
    textarea.value = '';
    fit();
  }

  export function caret(offset: number): void {
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(offset, offset);
    report();
  }

  $effect(() => {
    draft;
    decorated;
    void tick().then(() => {
      fit();
      report();
    });
  });

  $effect(() => {
    ghost;
    void tick().then(pin);
  });

  onMount(() => {
    const observer = new ResizeObserver(fit);
    if (textarea) observer.observe(textarea);
    fit();
    return () => observer.disconnect();
  });
</script>

<div class="relative min-w-0">
  {#if decorated}
    <div bind:this={mirror} class={[COMPOSER_INPUT_CLASS, 'mirror']} aria-hidden="true">
      {#each segments as segment}{#if segment.kind === 'text'}{segment.text}{:else if segment.kind === 'ghost'}<span class="ghost"
            >{segment.text}</span
          >{:else}<mark>{segment.text}</mark>{/if}{/each}{'\u200b'}
    </div>
  {/if}
  <textarea
    bind:this={textarea}
    class={[COMPOSER_INPUT_CLASS, 'prompt', decorated && 'decorated']}
    rows="1"
    value={draft}
    placeholder={hint === null ? placeholder : ''}
    aria-label={placeholder}
    aria-autocomplete="list"
    aria-controls={menuOpen ? menuId : undefined}
    aria-activedescendant={menuOpen ? activeId : undefined}
    onbeforeinput={before}
    oninput={input}
    onpaste={onPaste}
    onclick={report}
    onselect={report}
    onkeyup={report}
    onfocus={report}
    onblur={(event) => onBlur(event.relatedTarget)}
    onscroll={scroll}
    oncompositionstart={() => {
      composing = true;
      onBlur(null);
    }}
    oncompositionend={() => {
      composing = false;
      report();
    }}
    onkeydown={(event) => {
      if (composing || event.isComposing || event.keyCode === 229) return;
      onKeydown(event);
    }}></textarea>
  {#if hint !== null && draft === ''}
    <div class={[COMPOSER_INPUT_CLASS, 'hint']} aria-hidden="true" data-fade {@attach clipFade}>{@render hint()}</div>
  {/if}
</div>

<style>
  .prompt,
  .mirror {
    font-variant-ligatures: none;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
    tab-size: 4;
  }
  .prompt {
    position: relative;
  }
  @media (pointer: coarse) {
    .prompt,
    .mirror {
      font-size: var(--text-page);
    }
  }
  .prompt::placeholder {
    font-size: var(--text-ui);
    color: color-mix(in oklch, var(--muted-foreground), transparent 50%);
  }
  .hint {
    font-size: var(--text-ui);
    color: var(--muted-foreground);
    opacity: 0.5;
  }
  .hint :global(kbd) {
    color: inherit;
  }
  .prompt::placeholder {
    -webkit-text-fill-color: color-mix(in oklch, var(--muted-foreground), transparent 50%);
  }
  .mirror {
    position: absolute;
    inset: 0 auto auto 0;
    pointer-events: none;
    overflow: hidden;
  }
  .hint {
    position: absolute;
    inset: 0 0 auto 0;
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
    min-height: 0;
    max-height: none;
    overflow: hidden;
    pointer-events: none;
  }
  .decorated {
    color: transparent;
    -webkit-text-fill-color: transparent;
    caret-color: var(--foreground);
  }
  .decorated::selection {
    background: color-mix(in oklch, var(--chat-skill), transparent 75%);
  }
  .ghost {
    color: var(--muted-foreground);
  }
  mark {
    color: var(--chat-skill);
    background: color-mix(in oklch, var(--chat-skill), transparent 89%);
    outline: 1px solid color-mix(in oklch, var(--chat-skill), transparent 65%);
    outline-offset: -1px;
    border-radius: var(--radius-sm);
    padding: 0;
    font: inherit;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
</style>
