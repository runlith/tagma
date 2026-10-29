export type Masked = { readonly text: string; readonly held: readonly string[] };

const PLACEHOLDER = /⟦(\d+)⟧/gu;

const DESTINATION = String.raw`(?:[^()\s]|\((?:[^()\s]|\([^()\s]*\))*\))+(?:\s+"[^"\n]*")?`;

const PASSES: readonly ((text: string, hold: (kept: string) => string) => string)[] = [
  (text, hold) => text.replace(PLACEHOLDER, (written) => hold(written)),
  (text, hold) =>
    text.replace(
      /^([ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+|>[ \t]?)*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t>]*\2[ \t]*$|(?![\s\S]))/gmu,
      (fence, lead: string) => lead + hold(fence.slice(lead.length)),
    ),
  (text, hold) => text.replace(/(`+)(?!`)[\s\S]+?(?<!`)\1(?!`)/gu, (code) => hold(code)),
  (text, hold) => text.replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/gu, (_, target: string, label: string) => `[[${hold(target)}|${label}]]`),
  (text, hold) => text.replace(/\[\[[^\]|\n]+\]\]/gu, (link) => hold(link)),
  (text, hold) => text.replace(new RegExp(String.raw`\]\((${DESTINATION})\)`, 'gu'), (_, target: string) => `](${hold(target)})`),
  (text, hold) => text.replace(/\]\[([^\]\n]+)\]/gu, (_, key: string) => `][${hold(key)}]`),
  (text, hold) => text.replace(/<[a-z][a-z0-9+.-]*:[^>\s]*>/giu, (link) => hold(link)),
  (text, hold) => text.replace(/\bhttps?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/gu, (url) => hold(url)),
];

export const mask = (source: string): Masked => {
  const held: string[] = [];
  const hold = (kept: string) => `⟦${held.push(kept)}⟧`;
  const text = PASSES.reduce((current, pass) => pass(current, hold), source);
  return { text, held };
};

export const unmask = (text: string, held: readonly string[]): string =>
  text.replace(PLACEHOLDER, (written, n: string) => held[Number(n) - 1] ?? written);

export const placeholderFault = (text: string, held: readonly string[]): string | null => {
  const seen = new Map<number, number>();
  for (const [, n] of text.matchAll(PLACEHOLDER)) seen.set(Number(n), (seen.get(Number(n)) ?? 0) + 1);
  for (const [n, times] of seen) {
    if (n < 1 || n > held.length) return `it invents the placeholder ⟦${n}⟧`;
    if (times > 1) return `it repeats the placeholder ⟦${n}⟧`;
  }
  const lost = held.findIndex((_, at) => !seen.has(at + 1));
  return lost < 0 ? null : `it drops the placeholder ⟦${lost + 1}⟧`;
};
