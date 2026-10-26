<script lang="ts">
  import type { ToolActivityEntry } from '@runlith/chat-ui/activity';
  import { untrack } from 'svelte';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import { Door } from '$lib/wire/Door.js';
  import { Live } from '$lib/wire/Live.js';
  import { argumentsOf, needed, openLink } from '../views/params.js';
  import { resourceSubscription } from '../views/resourceFeed.js';
  import ResultFrame from '../views/ResultFrame.svelte';
  import type { ViewDocument, ViewHost } from '../views/ViewBridge.js';

  let { entry, projectId, threadId }: { entry: ToolActivityEntry; projectId: number; threadId: string | null } = $props();

  const door = Door.use();
  const live = Live.use();
  const links = ExternalLinks.use();

  type Loaded =
    | { readonly view: ViewDocument; readonly bordered: boolean; readonly tool: Readonly<Record<string, unknown>> | undefined }
    | { readonly failure: string };

  const server = $derived(entry.display?.app?.server ?? '');
  const identity = $derived(entry.display?.app?.identity ?? '');
  const resource = $derived(entry.display?.app?.resource ?? '');
  const tool = $derived(entry.display?.app?.tool);

  let loaded = $state.raw<Loaded | null>(null);

  const lens = $derived({ project: String(projectId) });

  const textOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

  $effect(() => {
    const at = { server, identity, resource, tool };
    const scope = untrack(() => lens);
    const control = new AbortController();
    loaded = null;
    door.perform('open_mcp_app', at, scope, { signal: control.signal }).then(
      (answer) => {
        if (control.signal.aborted) return;
        loaded =
          answer.status === 'ok'
            ? {
                view: { html: answer.view.html, csp: answer.view.meta.csp ?? {}, permissions: {} },
                bordered: answer.view.meta.prefersBorder !== false,
                tool: answer.view.tool,
              }
            : { failure: `the server answered ${answer.status}` };
      },
      (failure: unknown) => {
        if (!control.signal.aborted) loaded = { failure: textOf(failure) };
      },
    );
    return () => control.abort();
  });

  const host = $derived.by((): ViewHost => {
    const at = { server, identity, resource };
    const scope = untrack(() => lens);
    const project = untrack(() => projectId);
    const thread = untrack(() => threadId);
    return {
      methods: {
        'tools/call': async (params, { signal }) => {
          const answer = await door.perform(
            'call_mcp_app_tool',
            {
              ...at,
              tool: needed(params, 'name'),
              arguments: argumentsOf(params),
              threadId: thread ?? undefined,
            },
            scope,
            { signal },
          );
          if (answer.status !== 'ok') throw new Error(`the server answered ${answer.status}`);
          return answer.result;
        },
        'resources/read': async (params, { signal }) => {
          const answer = await door.perform(
            'read_mcp_resource',
            { server: at.server, identity: at.identity, resource: at.resource, uri: needed(params, 'uri') },
            scope,
            { signal },
          );
          if (answer.status !== 'ok') throw new Error(`the server answered ${answer.status}`);
          return { contents: answer.contents, _meta: answer._meta };
        },
        'ui/open-link': openLink(links),
        'ui/request-display-mode': async () => ({ mode: 'inline' }),
      },
      subscribe: resourceSubscription(
        live,
        (uri) => (client) =>
          client['mcp.resource.subscribe']({
            projectId: project,
            server: at.server,
            identity: at.identity,
            resource: at.resource,
            uri,
          }),
      ),
      context: () => {
        const shown = loaded;
        return shown !== null && 'view' in shown && shown.tool !== undefined ? { toolInfo: { tool: shown.tool } } : {};
      },
    };
  });
</script>

{#if loaded !== null && 'view' in loaded}
  <ResultFrame {entry} view={loaded.view} {host} title={entry.display?.title ?? resource} bordered={loaded.bordered} />
{:else if loaded !== null && 'failure' in loaded}
  <p class="text-small text-chat-failure/90">{loaded.failure}</p>
{/if}
