import LanguagesIcon from '@lucide/svelte/icons/languages';
import X from '@lucide/svelte/icons/x';
import { Router } from '@runlith/layer/Router';
import { isBlockName } from '@tagma/server/graph/contract/wire/references';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { ActionEnv, ActionsModule } from '$lib/features/workspace/action.js';
import { currentLanguage, currentPlace, languageLensHref } from '$lib/features/workspace/address.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import { Translations } from './translation/Translations.svelte.js';

function blockShown(env: ActionEnv): string | null {
  const place = currentPlace(env.resolve(Router))?.toLowerCase() ?? null;
  return env.surface === env.resolve(SurfaceRegistry).root && place !== null && isBlockName(place) ? place : null;
}

export const actions: ActionsModule['actions'] = [
  {
    id: 'block.translate',
    order: 40,
    title: 'Translate block',
    keywords: ['translation', 'language'],
    icon: LanguagesIcon,
    available: (env) => blockShown(env) !== null && currentLanguage(env.resolve(Router)) === null,
    run: async (env) => {
      const block = blockShown(env);
      if (block === null) return;
      const router = env.resolve(Router);
      const from = router.url.href;
      try {
        const language = await env.resolve(Translations).press(block);
        if (router.url.href === from) env.goto(languageLensHref(router, language));
      } catch (error: unknown) {
        env.resolve(Notices).refusal(error);
      }
    },
  },
  {
    id: 'block.original',
    order: 40,
    title: 'Show the original',
    keywords: ['translation', 'language'],
    icon: X,
    available: (env) => blockShown(env) !== null && currentLanguage(env.resolve(Router)) !== null,
    run: (env) => env.goto(languageLensHref(env.resolve(Router), null)),
  },
];
