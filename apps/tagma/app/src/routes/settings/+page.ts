import { App } from '@runlith/layer/sveltekit';
import { Host } from '@runlith/layer/Host';
import { runtime } from '$lib/app/runtime.js';

export const load = App.load(runtime, function* () {
  const mobile = (yield* Host).kind === 'mobile';
  return (mobile ? import('$lib/app/mobile/Device.svelte') : import('$lib/app/chrome/Settings.svelte')).then((page) => ({
    Page: page.default,
  }));
});
