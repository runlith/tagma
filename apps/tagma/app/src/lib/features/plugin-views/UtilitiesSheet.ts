import { Service } from '@runlith/layer/key';

export interface SheetPort {
  show(address: string | null): void;
}

export class UtilitiesSheet extends Service<SheetPort>()('UtilitiesSheet', { tier: 'app' }) {}

export const unshownSheet: SheetPort = { show: () => undefined };

export function adoptedSheet(read: (address: string) => Promise<string>): SheetPort {
  let asked: string | null = null;
  let adopted: CSSStyleSheet | null = null;
  const replaced = (next: CSSStyleSheet | null): void => {
    const others = document.adoptedStyleSheets.filter((sheet) => sheet !== adopted);
    document.adoptedStyleSheets = next === null ? others : [...others, next];
    adopted = next;
  };
  return {
    show: (address) => {
      if (address === asked) return;
      asked = address;
      if (address === null) return replaced(null);
      void read(address)
        .then((css) => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(css);
          if (asked === address) replaced(sheet);
        })
        .catch(() => {
          if (asked === address) asked = null;
        });
    },
  };
}
