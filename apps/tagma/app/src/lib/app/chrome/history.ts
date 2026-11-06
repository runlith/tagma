import { Host } from '@runlith/layer/Host';
import { Router } from '@runlith/layer/Router';
import type { ActionEnv, ActionList } from '$lib/features/workspace/action.js';

const travels = (env: ActionEnv): boolean => {
  const host = env.resolve(Host);
  return host.isDesktop || host.framed;
};

const travel = (env: ActionEnv, direction: -1 | 1): void => {
  const router = env.resolve(Router);
  if (direction < 0 ? router.reach.back : router.reach.forward) router.traverse(direction);
};

export const history: ActionList = [
  {
    id: 'history.back',
    title: 'Go back',
    palette: false,
    keys: { mac: ['Mod+BracketLeft'], other: ['Alt+ArrowLeft'] },
    available: travels,
    run: (env) => travel(env, -1),
  },
  {
    id: 'history.forward',
    title: 'Go forward',
    palette: false,
    keys: { mac: ['Mod+BracketRight'], other: ['Alt+ArrowRight'] },
    available: travels,
    run: (env) => travel(env, 1),
  },
];
