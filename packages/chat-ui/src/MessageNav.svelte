<script lang="ts">
  import type { ChatEntry } from './entries';
  import { clipFade } from './clipFade';
  import { messageTime } from './chatTime';
  import { useChatStrings } from './strings';

  type Props = {
    currentId?: string;
    users: readonly ChatEntry[];
    onSelect(id: string): void;
  };

  let { currentId = undefined, users, onSelect }: Props = $props();
  const strings = useChatStrings();

  const SHOWN_FROM = 2;
  const REACH_PX = 46;

  const messages = $derived(
    users.map((entry) => ({
      id: entry.id,
      label: label(entry),
      at: entry.occurredAt ? messageTime(entry.occurredAt, strings.locale) : null,
    })),
  );

  let list = $state<HTMLUListElement | null>(null);
  let pointer = $state<number | null>(null);
  let centers = $state<readonly number[]>([]);
  let hovered = $state<number | null>(null);

  function label(entry: ChatEntry): string {
    const text = ('text' in entry ? (entry.text ?? '') : '').trim();
    if (text) return text.split(/\s+/).slice(0, 14).join(' ');
    const count = 'attachments' in entry ? (entry.attachments?.length ?? 0) : 0;
    if (count > 0) return count === 1 ? strings.imagePrompt() : strings.attachmentsCount(count);
    return strings.prompt();
  }

  function measure(): void {
    if (list === null) return;
    const top = list.getBoundingClientRect().top;
    centers = [...list.children].map((child) => {
      const box = child.getBoundingClientRect();
      return box.top - top + box.height / 2;
    });
  }

  function track(event: PointerEvent): void {
    if (list === null) return;
    if (centers.length !== messages.length) measure();
    const y = event.clientY - list.getBoundingClientRect().top;
    pointer = y;
    let nearest = 0;
    centers.forEach((center, index) => {
      if (Math.abs(center - y) < Math.abs((centers[nearest] ?? 0) - y)) nearest = index;
    });
    hovered = nearest;
  }

  function leave(): void {
    pointer = null;
    hovered = null;
  }

  function grow(index: number): number {
    if (pointer === null) return 0;
    const center = centers[index];
    return center === undefined ? 0 : Math.max(0, 1 - Math.abs(center - pointer) / REACH_PX);
  }

  const tip = $derived(hovered === null ? null : { message: messages[hovered], top: centers[hovered] ?? 0 });
</script>

{#if messages.length >= SHOWN_FROM}
  <div aria-label={strings.messageNavigation()} class="pointer-events-auto relative" role="navigation">
    <ul
      bind:this={list}
      class="m-0 grid max-h-[min(60vh,520px)] w-2.5 list-none gap-1 overflow-y-auto p-0 no-scrollbar"
      onpointermove={track}
      onpointerleave={leave}
      onscroll={measure}
    >
      {#each messages as message, index (message.id)}
        {@const lift = grow(index)}
        {@const current = message.id === currentId}
        <li class="grid h-3">
          <button
            aria-label={message.label}
            aria-current={current ? 'location' : undefined}
            class="grid h-3 w-2.5 cursor-pointer place-items-center bg-transparent p-0"
            type="button"
            onclick={() => onSelect(message.id)}
          >
            <span
              class={['block transition-all duration-150 ease-out', current ? 'bg-chat-here' : 'bg-foreground']}
              style:width={`calc(var(--spacing) * ${(current ? 2 : 1.5) + lift * 0.5})`}
              style:height={`calc(var(--spacing) * ${(current ? 2 : 1.5) + lift * 0.5})`}
              style:opacity={current ? 1 : 0.3 + lift * 0.6}
            ></span>
          </button>
        </li>
      {/each}
    </ul>

    {#if tip !== null && tip.message !== undefined}
      <div
        class="pointer-events-none absolute left-full ml-2 flex max-w-72 -translate-y-1/2 items-center gap-2 rounded-md border border-border bg-popover px-2 py-1 text-ui whitespace-nowrap text-popover-foreground shadow-raised"
        style:top={`${tip.top}px`}
      >
        <span class="min-w-0" data-fade {@attach clipFade}>{tip.message.label}</span>
        {#if tip.message.at !== null}<span class="shrink-0 text-small text-muted-foreground tabular-nums">{tip.message.at}</span>{/if}
      </div>
    {/if}
  </div>
{/if}
