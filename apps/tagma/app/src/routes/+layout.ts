import '$lib/app/renamedKeys.js';
import { App } from '@runlith/layer/sveltekit';
import { admission } from '$lib/app/admission.js';
import { Door } from '$lib/wire/Door.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { Host } from '@runlith/layer/Host';
import { runtime } from '$lib/app/runtime.js';

export const ssr = false;
export const prerender = false;

export const load = App.load(runtime, function* () {
  const refusal = admission(yield* Door, yield* ServerOrigin);
  const shell = (yield* Host).kind === 'mobile' ? import('$lib/app/mobile/Shell.svelte') : import('$lib/app/chrome/Shell.svelte');
  return Promise.all([shell, refusal]).then(([loaded, refused]) => ({ Shell: loaded.default, refusal: refused }));
});
