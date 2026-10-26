import { cn } from '../utils.js';

export function tabLook(on: boolean): string {
  return cn(
    'flex cursor-default items-center rounded-md text-small outline-none transition-colors focus-visible:inset-ring-1 focus-visible:inset-ring-ring',
    on ? 'bg-selected text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
  );
}
