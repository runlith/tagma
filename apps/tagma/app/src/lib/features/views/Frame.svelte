<script lang="ts" module>
  import { innerHeight } from 'svelte/reactivity/window';

  const VIEWPORT_SHARE = 0.8;

  export const tallest = (ceiling: number | null = null): number =>
    ceiling ?? Math.round((innerHeight.current ?? window.innerHeight) * VIEWPORT_SHARE);

  export type FrameLink = {
    readonly receive: (event: MessageEvent) => void;
    readonly loaded?: () => void;
    readonly close?: (within: number) => Promise<void> | null;
    readonly dispose: () => void;
  };

  export type FrameProtocol = (frame: HTMLIFrameElement) => FrameLink;
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { park } from './parking.js';

  type Props = {
    src: string;
    title: string;
    sandbox: string;
    protocol: FrameProtocol;
    allow?: string;
    fill?: boolean;
    height?: number | null;
    zoom?: number;
    inert?: boolean;
    class?: ClassValue;
  };

  let { src, title, sandbox, protocol, allow, fill = false, height = null, zoom = 1, inert = false, class: style }: Props = $props();

  const scaled = $derived(zoom !== 1);

  const CLOSE_MS = 1_000;

  let frame = $state<HTMLIFrameElement | null>(null);
  let link: FrameLink | null = null;
  let closing: Promise<void> | null = null;

  const closed = (node: HTMLElement) => {
    const made = link;
    const target = untrack(() => frame);
    if (made === null || target === null || closing !== null) return { duration: 0 };
    const answered = made.close?.(CLOSE_MS) ?? null;
    if (answered === null) return { duration: 0 };
    closing = park(target, answered);
    if (closing !== null) return { duration: 0 };
    closing = answered.then(() => {
      for (const running of node.getAnimations()) running.finish();
    });
    return { delay: CLOSE_MS, duration: 0 };
  };

  $effect(() => {
    const target = frame;
    const make = protocol;
    if (target === null) return;
    const made = untrack(() => make(target));
    closing = null;
    link = made;
    const listen = (event: MessageEvent) => made.receive(event);
    const loaded = () => made.loaded?.();
    window.addEventListener('message', listen);
    target.addEventListener('load', loaded);
    return () => {
      target.removeEventListener('load', loaded);
      if (link === made) link = null;
      const leave = () => {
        window.removeEventListener('message', listen);
        made.dispose();
      };
      if (closing === null) leave();
      else void closing.then(leave);
    };
  });
</script>

<div
  out:closed|global
  class={[fill && 'h-full', scaled && 'overflow-hidden']}
  style:height={!fill && scaled && height !== null ? `${height}px` : undefined}
>
  <iframe
    bind:this={frame}
    {src}
    {title}
    {sandbox}
    {allow}
    {inert}
    class={['block', !scaled && 'w-full', fill && !scaled && 'h-full', style]}
    style:width={scaled ? `${100 / zoom}%` : undefined}
    style:height={scaled
      ? fill
        ? `${100 / zoom}%`
        : height === null
          ? undefined
          : `${height / zoom}px`
      : fill || height === null
        ? undefined
        : `${height}px`}
    style:transform={scaled ? `scale(${zoom})` : undefined}
    style:transform-origin={scaled ? '0 0' : undefined}
  ></iframe>
</div>
