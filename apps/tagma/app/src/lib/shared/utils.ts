import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  override: {
    theme: {
      text: ['meta', 'small', 'ui', 'body', 'page', 'title'],
      shadow: ['raised', 'float'],
      radius: ['sm', 'md', 'lg'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function barTrigger(active: boolean): string {
  return cn(
    'flex h-7 items-center gap-1.5 rounded-lg px-2 text-small transition-colors duration-150 ease-instrument data-[state=open]:bg-selected data-[state=open]:text-foreground',
    active ? 'bg-selected font-medium text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
  );
}

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
