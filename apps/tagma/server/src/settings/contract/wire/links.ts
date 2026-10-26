import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';

export const LINKS_SETTING_SECTIONS = [
  {
    id: 'links',
    order: 25,
    title: 'Links',
    description: 'Where a link to a file, block, commit, thread or site opens when you click it.',
  },
] as const;

export const LINK_CLICKS = ['beside', 'section'] as const;

export type LinkClick = (typeof LINK_CLICKS)[number];

export const linksClick = settingKey({
  id: 'links.click',
  order: 10,
  title: 'A click on a link opens',
  description:
    'beside: a click opens the thing as a tab in the area beside your work, and ⌘-click (Ctrl elsewhere) opens it in its section — Files, Knowledge, Git, the thread in place, or the system browser for a site. section: the two swap. The right-click menu lists both and every other place.',
  schema: Schema.Literals(LINK_CLICKS),
  fallback: 'beside',
  scopes: ['user'],
  merge: 'replace',
});
