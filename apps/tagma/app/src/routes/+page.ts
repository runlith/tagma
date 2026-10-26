import { redirect } from '@sveltejs/kit';
import { App } from '@runlith/layer/sveltekit';
import { Host } from '@runlith/layer/Host';
import { runtime } from '$lib/app/runtime.js';
import { Visits } from '$lib/features/workspace/Visits.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';

export const load = App.load(runtime, function* () {
  if ((yield* Host).kind === 'mobile') return import('$lib/app/mobile/Home.svelte').then((page) => ({ Page: page.default }));
  const workspace = yield* Workspace;
  const visits = yield* Visits;
  return workspace.ready.then(async () => {
    const entry = workspace.resumed();
    if (entry !== null) redirect(307, visits.resume(entry.name));
    return { Page: (await import('$lib/app/chrome/Start.svelte')).default };
  });
});
