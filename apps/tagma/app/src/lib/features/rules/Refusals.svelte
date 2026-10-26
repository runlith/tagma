<script lang="ts">
  import type { RefusalPlace } from '@tagma/server/enforcement/contract/wire/engines';
  import { Router } from '@runlith/layer/Router';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { commitLink } from '$lib/features/checkout/links.js';
  import { NATIVE_HARNESS } from '@tagma/server/platform/contract/wire/session';
  import WriterBadge from '$lib/features/graph/WriterBadge.svelte';
  import type { Link } from '$lib/features/opening/Link.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { currentProject } from '$lib/features/workspace/address.js';
  import Findings from './Findings.svelte';
  import type { Found } from './found.js';
  import { agoSaid } from '$lib/shared/time.js';
  import { actSaid } from './words.js';

  let {
    rows,
    total,
    more,
    now,
    general,
    link,
  }: {
    rows: readonly RefusalPlace[];
    total: number;
    more: (() => void) | null;
    now: number;
    general: string | null;
    link: (file: string, line: number | null) => Link;
  } = $props();

  type Placed = Found & { readonly refusal: RefusalPlace };

  const RECENT = 20;

  const router = Router.use();
  const addresses = Addresses.use();
  const opening = Opening.use();
  const here = App.current();

  const found = $derived(
    rows.map((refusal): Placed => ({
      key: refusal.fingerprint,
      at: refusal.at,
      file: refusal.file,
      line: refusal.line,
      said: refusal.said,
      fix: refusal.fix,
      times: refusal.times,
      refusal,
    })),
  );

  const act = (op: string): string => {
    const said = actSaid(op);
    return `${said.slice(0, 1).toUpperCase()}${said.slice(1)}`;
  };
</script>

<Findings rows={found} {total} {more} {now} {general} {link} initial={RECENT}>
  {#snippet detail({ refusal })}
    {#if refusal.said === null}
      <p>
        {#if refusal.reached !== null}Imports <code class="font-mono text-foreground/80">{refusal.reached}</code>.{/if}
        Recorded before the check said why.
      </p>
    {/if}
    <p>
      {act(refusal.op)}
      {#if refusal.actor?.kind === 'thread'}
        by <WriterBadge writer={{ harness: NATIVE_HARNESS, key: refusal.actor.threadId }} project={refusal.actor.projectId} />
      {:else if refusal.actor?.kind === 'session'}
        by <WriterBadge writer={refusal.actor.session} project={refusal.actor.projectId} />
      {:else if refusal.actor?.kind === 'operator'}
        by you
      {/if}
      {#if refusal.branch}on <span class="text-foreground/80">{refusal.branch}</span>{/if}
      {#if refusal.base}{@const base = refusal.base}against
        <a
          class="font-mono text-foreground/80 hover:text-foreground"
          href={addresses.commit(base)}
          {@attach linkTarget(opening, () => commitLink({ sha: base, project: currentProject(router) }), here)}>{base.slice(0, 8)}</a
        >{/if}, {agoSaid(refusal.at)}.
      {#if refusal.times > 1}Refused here {refusal.times} times{refusal.first === refusal.at
          ? ''
          : `, first ${agoSaid(refusal.first)}`}.{/if}
    </p>
  {/snippet}
</Findings>
