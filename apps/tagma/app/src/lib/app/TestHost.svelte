<script lang="ts">
  import type { MountedApp } from '@runlith/layer/App';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import DialogHost from '@runlith/primitives/DialogHost.svelte';
  import LauncherHost from '@runlith/primitives/LauncherHost.svelte';
  import type { Component } from 'svelte';
  import { untrack } from 'svelte';

  const props: {
    app: MountedApp;
    view?: Component<never>;
    props?: Record<string, unknown>;
  } = $props();

  const { app, view } = untrack(() => ({ app: props.app, view: props.view }));

  App.attach(app);

  const View = view as Component<Record<string, unknown>> | undefined;
</script>

{#if View}<View {...props.props ?? {}} />{/if}
<DialogHost />
<LauncherHost />
