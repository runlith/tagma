import type { Strictness } from '../../../graph/contract/wire/enforcement.js';

export type Norm = { readonly rule: string; readonly title: string; readonly strictness?: Strictness };

export type Said = { readonly message: string; readonly chain?: readonly string[] };

export type Placed = { readonly file: string; readonly line?: number };

export type Finding = Norm & Said & Placed & { readonly fix?: string | undefined; readonly generalFix: string };

export type Noted<F> = (finding: F) => string;

export const normSaid = ({ rule, title, strictness }: Norm): string =>
  [rule, title === '' ? '' : `“${title}”`, strictness ?? ''].filter((part) => part !== '').join(' · ');

export const placeSaid = ({ file, line }: Placed): string => (line === undefined ? file : `${file}:${line}`);

export const chainSaid = (chain: readonly string[] | undefined): string | null =>
  chain === undefined || chain.length < 2 ? null : chain.join(' → ');

export const said = ({ message, chain }: Said): string => {
  const via = chainSaid(chain);
  return via === null ? message : `${message} · via ${via}`;
};

export const findingLine = (one: Placed & Said): string => {
  const what = said(one);
  return what === '' ? placeSaid(one) : `${placeSaid(one)} ${what}`;
};

const grouped = <F extends Finding>(findings: readonly F[]): readonly (readonly F[])[] => {
  const groups = new Map<string, F[]>();
  for (const one of findings) {
    const key = `${one.rule}\0${one.title}\0${one.strictness ?? ''}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [one]);
    else group.push(one);
  }
  return [...groups.values()];
};

export const generalLines = (general: string | null | undefined, at: string, everywhere: boolean): string[] =>
  general === null || general === undefined || general === ''
    ? []
    : [`${at}${everywhere ? 'fix' : 'fix where a place names none'}: ${general}`];

export const findingLines = <F extends Finding>(findings: readonly F[], indent = '', noted?: Noted<F>): string[] =>
  grouped(findings).flatMap((group) => {
    const [first] = group;
    if (first === undefined) return [];
    const at = `${indent}  `;
    const placed = (one: F): string => {
      const note = noted?.(one) ?? '';
      return `${at}${findingLine(one)}${note === '' ? '' : ` — ${note}`}`;
    };
    const own = group.map((one) => one.fix ?? '');
    const bare = own.filter((fix) => fix === '').length;
    const [shared = ''] = own;
    const alike = bare === 0 && own.every((fix) => fix === shared);
    const nested = bare < group.length && !alike;
    const general = group.find((one) => one.generalFix !== '')?.generalFix;
    const head = alike ? [`${at}fix: ${shared}`] : bare === 0 ? [] : generalLines(general, at, bare === group.length);
    return [
      `${indent}${normSaid(first)}`,
      ...head,
      ...group.flatMap((one, n) => [placed(one), ...(nested && own[n] !== '' ? [`${at}  fix: ${own[n]}`] : [])]),
    ];
  });
