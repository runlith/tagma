import type { Picked } from '@tagma/server/browser/contract/wire/pick';
import { Service } from '@runlith/layer/key';
import { type PickHost, PickScreen } from './PickScreen.js';

const HTML_CHARS = 2_000;

const fenced = (text: string): string => `\`\`\`\n${text.replaceAll('```', '`\u200b``')}\n\`\`\``;

const pickedText = (picked: Picked, title: string): string => {
  const rows = (record: Readonly<Record<string, string>>) =>
    Object.entries(record)
      .map(([name, value]) => `  - ${name}: ${value}`)
      .join('\n');
  const rect = picked.rect;
  return [
    `# ${title}`,
    '',
    `Element picked on browser page \`${picked.page}\` at ${picked.url}.`,
    `Act on it at once with ref \`${picked.ref}\` on page \`${picked.page}\` (act_on_page); it needs no snapshot first.`,
    '',
    `- role: ${picked.role || '—'}`,
    `- name: ${picked.name || '—'}`,
    `- tag: ${picked.tag}`,
    `- selector: \`${picked.selector}\``,
    ...(picked.component === undefined
      ? []
      : [
          `- component: ${picked.component.name ?? 'unnamed'} (${picked.component.framework})`,
          ...(picked.component.source === null
            ? []
            : [
                `- source: \`${picked.component.source.file}${picked.component.source.line === null ? '' : `:${picked.component.source.line}`}${picked.component.source.column === null ? '' : `:${picked.component.source.column}`}\` (${picked.component.source.resolved ? 'checkout' : 'unresolved'}; ${picked.component.source.basis})`,
              ]),
        ]),
    `- box: ${Math.round(rect.x)}, ${Math.round(rect.y)}, ${Math.round(rect.width)}×${Math.round(rect.height)}`,
    ...(Object.keys(picked.attributes).length > 0 ? ['- attributes:', rows(picked.attributes)] : []),
    ...(Object.keys(picked.styles).length > 0 ? ['- styles:', rows(picked.styles)] : []),
    ...(picked.text === '' ? [] : ['', 'Text:', fenced(picked.text)]),
    '',
    'HTML:',
    fenced(picked.html.slice(0, HTML_CHARS)),
  ].join('\n');
};

const pictureOf = async (picked: Picked): Promise<File | null> => {
  if (picked.picture === null) return null;
  const blob = await (await fetch(`data:image/png;base64,${picked.picture}`)).blob();
  return new File([blob], `element-${picked.ref}.png`, { type: 'image/png' });
};

export class Picks extends Service<Picks>()('Picks', { tier: 'app' }) {
  static *make() {
    return new Picks(yield* PickScreen);
  }

  constructor(private readonly screen: PickHost) {
    super();
  }

  async stage(picked: Picked): Promise<string | null> {
    const host = this.screen.host;
    if (host === null) return 'No thread is open to take the element.';
    const title = `Element · ${(picked.name.trim() || picked.selector).replace(/\s+/g, ' ').trim()}`;
    host.stageDocument({ id: crypto.randomUUID(), title, text: pickedText(picked, title) });
    const picture = await pictureOf(picked);
    if (picture === null) return null;
    return (await host.attach([picture])).notice ?? null;
  }
}
