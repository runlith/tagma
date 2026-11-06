import type { Failure } from '@runlith/layer/Failure';
import { Service } from '@runlith/layer/key';

export interface SheetPort {
  show(address: string | null): void;
}

export class UtilitiesSheet extends Service<SheetPort>()('UtilitiesSheet', { tier: 'app' }) {}

export const unshownSheet: SheetPort = { show: () => undefined };

type SetAside = { readonly sheet: CSSStyleSheet; readonly index: number; readonly text: string };

const isUtilities = (rule: CSSRule): boolean => rule instanceof CSSLayerBlockRule && rule.name === 'utilities';

function setAside(sheets: readonly CSSStyleSheet[]): SetAside[] {
  const aside: SetAside[] = [];
  for (const sheet of sheets)
    for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
      const rule = sheet.cssRules[index]!;
      if (!isUtilities(rule)) continue;
      aside.unshift({ sheet, index, text: rule.cssText });
      sheet.deleteRule(index);
    }
  return aside;
}

export function adoptedSheet(read: (address: string) => Promise<string>, failure: Failure, origin: string): SheetPort {
  const windowOrigin = new URL(origin).origin;
  let asked: string | null = null;
  let adopted: CSSStyleSheet | null = null;
  let failed: string | null = null;
  let reading = false;
  let aside: SetAside[] | null = null;
  const ownSheets = (): CSSStyleSheet[] =>
    [...document.styleSheets].filter((sheet) => sheet.href === null || new URL(sheet.href).origin === windowOrigin);
  const replaced = (next: CSSStyleSheet | null): void => {
    const others = document.adoptedStyleSheets.filter((sheet) => sheet !== adopted);
    document.adoptedStyleSheets = next === null ? others : [...others, next];
    adopted = next;
    if (next !== null && aside === null) aside = setAside(ownSheets());
    if (next === null && aside !== null) {
      for (const { sheet, index, text } of aside) sheet.insertRule(text, index);
      aside = null;
    }
  };
  return {
    show: (address) => {
      if (address === asked && (failed !== address || reading)) return;
      asked = address;
      if (address === null) {
        failed = null;
        return replaced(null);
      }
      reading = true;
      void read(address)
        .then((css) => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(css);
          if (asked !== address) return;
          failed = null;
          replaced(sheet);
        })
        .catch((error: unknown) => {
          if (asked !== address) return;
          if (failed !== address) failure.report(error);
          failed = address;
        })
        .finally(() => {
          reading = false;
        });
    },
  };
}
