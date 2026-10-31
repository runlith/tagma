<script lang="ts">
  import { TOOL_VIEW_PX } from '@runlith/chat-ui/rowEstimate';
  import { type ViewIdentity, viewFrameName } from '@tagma/server/executions/contract/wire/viewName';
  import { Host } from '@runlith/layer/Host';
  import { untrack } from 'svelte';
  import { Platform } from '@runlith/layer/Platform';
  import { Theme } from '$lib/shared/Theme.svelte.js';
  import { innerHeight, innerWidth } from 'svelte/reactivity/window';
  import Frame, { type FrameProtocol, tallest } from './Frame.svelte';
  import { hostStyles } from './hostStyles.js';
  import { reaches } from './reach.js';
  import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
  import { ViewBridge, type ViewDocument, type ViewHost } from './ViewBridge.js';

  type Props = {
    view: ViewDocument;
    host: ViewHost;
    title: string;
    identity: ViewIdentity;
    bordered: boolean;
    fill?: boolean;
    ceiling?: number | null;
    initialized?: () => void;
    bridge?: ViewBridge | null;
  };

  let { view, host, title, identity, bordered, fill = false, ceiling = null, initialized, bridge = $bindable(null) }: Props = $props();

  const shell = Host.use().kind;

  const server = ServerOrigin.use();
  const theme = Theme.use();
  const platform = Platform.use();

  const CONTEXT_CHANGED = 'ui/notifications/host-context-changed';
  const PROXY_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-pointer-lock';
  const SITE_SANDBOX = `${PROXY_SANDBOX} allow-popups`;
  const PROXY_ALLOWS = 'fullscreen; autoplay';
  const SITE_ALLOWS = `${PROXY_ALLOWS}; encrypted-media; picture-in-picture`;

  let frame = $state<HTMLIFrameElement | null>(null);
  let reported = $state<number | null>(null);
  let ready = $state(false);
  let reachable = $state<boolean | null>(null);

  const page = $derived('src' in view ? new URL(view.src) : null);
  const origin = $derived(page?.origin ?? server.sandbox);
  const src = $derived.by(() => {
    if ('src' in view) return reachable === true ? view.src : null;
    return server.sandbox === null ? null : `${server.sandbox}/?csp=${encodeURIComponent(JSON.stringify(view.csp))}`;
  });
  const height = $derived(Math.min(reported ?? TOOL_VIEW_PX, tallest(ceiling)));

  const contextOf = (target: HTMLIFrameElement) => () => ({
    ...host.context(),
    theme: theme.mode,
    styles: hostStyles(),
    displayMode: 'inline',
    availableDisplayModes: ['inline'],
    containerDimensions: fill
      ? { width: target.clientWidth, height: target.clientHeight }
      : { width: target.clientWidth, maxHeight: tallest(ceiling) },
    locale: platform.languages[0],
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: shell === 'tab' ? 'web' : shell,
    userAgent: 'tagma',
  });

  $effect(() => {
    const made = bridge;
    const target = frame;
    void theme.mode;
    void innerHeight.current;
    void innerWidth.current;
    void ceiling;
    if (made === null || target === null || !ready) return;
    const tell = (): void => {
      const { theme, styles, containerDimensions } = contextOf(target)();
      made.notify(CONTEXT_CHANGED, { theme, styles, containerDimensions });
    };
    const told = requestAnimationFrame(tell);
    const resizing = untrack(() => fill) ? new ResizeObserver(() => requestAnimationFrame(tell)) : null;
    resizing?.observe(target);
    return () => {
      cancelAnimationFrame(told);
      resizing?.disconnect();
    };
  });

  $effect(() => {
    const at = page;
    if (at === null) return;
    let live = true;
    const probe = () =>
      void reaches(at).then((answered) => {
        if (live) reachable = answered;
      });
    reachable = null;
    probe();
    window.addEventListener('focus', probe);
    window.addEventListener('online', probe);
    return () => {
      live = false;
      window.removeEventListener('focus', probe);
      window.removeEventListener('online', probe);
    };
  });

  const protocol = $derived.by((): FrameProtocol | null => {
    const at = origin;
    if (at === null) return null;
    return (target) => {
      let sized = 0;
      let latest = 0;
      const made = new ViewBridge(
        { origin: at, source: () => target.contentWindow, post: (message) => target.contentWindow?.postMessage(message, at) },
        { ...host, context: contextOf(target) },
        view,
        {
          initialized: () => {
            ready = true;
            initialized?.();
          },
          resized: (size) => {
            if (size.height === undefined) return;
            latest = Math.ceil(size.height);
            if (sized === 0) {
              sized = requestAnimationFrame(() => {
                sized = 0;
                reported = latest;
              });
            }
          },
        },
      );
      ready = false;
      frame = target;
      bridge = made;
      return {
        receive: (event) => made.receive(event),
        close: (within) => (made.initialized ? made.close('the host unmounted the view', within) : null),
        dispose: () => {
          cancelAnimationFrame(sized);
          if (untrack(() => bridge) === made) bridge = null;
          if (untrack(() => frame) === target) frame = null;
          made.dispose();
        },
      };
    };
  });
</script>

{#if src !== null && protocol !== null}
  <Frame
    {src}
    {title}
    name={viewFrameName(identity)}
    {protocol}
    {fill}
    {height}
    sandbox={page === null ? PROXY_SANDBOX : SITE_SANDBOX}
    allow={page === null ? PROXY_ALLOWS : SITE_ALLOWS}
    class={['bg-transparent', bordered ? 'rounded-lg border border-border' : 'border-0']}
  />
{:else if page !== null && reachable === false}
  <p class="text-small text-muted-foreground">
    This browser does not reach {page.host}, where the view is served{page.hostname.endsWith('.localhost')
      ? ': it does not resolve names under localhost. Open Tagma in its app, Chrome or Firefox.'
      : '.'}
  </p>
{/if}
