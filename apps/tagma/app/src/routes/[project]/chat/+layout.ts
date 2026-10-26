import { App } from '@runlith/layer/sveltekit';
import { Host } from '@runlith/layer/Host';
import { runtime } from '$lib/app/runtime.js';

export const load = App.load(runtime, function* () {
  const mobile = (yield* Host).kind === 'mobile';
  return (mobile ? import('$lib/app/mobile/ChatShell.svelte') : import('$lib/app/chrome/ChatShell.svelte')).then((shell) => ({
    ChatShell: shell.default,
  }));
});
