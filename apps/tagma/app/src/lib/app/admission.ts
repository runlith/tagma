import type { AccessRefusal } from '@tagma/server/remote/contract/wire/access';
import type { Door } from '$lib/wire/Door.js';
import { Refusal } from '$lib/wire/refusal.js';
import type { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { accessRefusal } from './chrome/WireState.svelte.js';

export async function admission(door: Door, origin: ServerOrigin): Promise<AccessRefusal | null> {
  if (origin.local) return null;
  try {
    origin.declare(await door.ask((api) => api.health.health()));
    return null;
  } catch (caught) {
    return caught instanceof Refusal ? accessRefusal(caught.code) : null;
  }
}
