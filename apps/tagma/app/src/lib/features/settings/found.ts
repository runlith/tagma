import { getContext, setContext } from 'svelte';

const FOUND = Symbol('settings.found');

type Found = () => string | null;

export function standFound(read: Found): void {
  setContext(FOUND, read);
}

export function foundReader(): Found {
  return getContext<Found | undefined>(FOUND) ?? (() => null);
}
