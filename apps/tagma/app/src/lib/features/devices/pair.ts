import { PAIRING_ENDPOINT, PairedAnswer } from '@tagma/server/remote/contract/wire/access';
import type { Door } from '$lib/wire/Door.js';

export const pair = (door: Door, code: string): Promise<PairedAnswer> => door.exchange(PAIRING_ENDPOINT, { code }, PairedAnswer);
