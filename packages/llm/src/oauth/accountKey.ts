import { AccountKey } from '../models/authStatus.js';

export const SINGLE_ACCOUNT_KEY = AccountKey.make('only');

export function signInDate(addedAt: number): string {
  return new Date(addedAt).toISOString().slice(0, 10);
}
