import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';
import { AGENT_PROFILE, ProfileId, USER_PROFILE } from './ids.js';

export const userProfile = settingKey({
  id: 'browser.userProfile',
  order: 100,
  title: 'Profile for your pages',
  description: 'The browser profile your own pages open in when no profile is named.',
  schema: ProfileId,
  fallback: USER_PROFILE,
  scopes: ['user', 'project'],
  merge: 'replace',
});

export const agentProfile = settingKey({
  id: 'browser.agentProfile',
  order: 110,
  title: 'Profile for agent pages',
  description: 'The browser profile pages opened by agents use when they name none.',
  schema: ProfileId,
  fallback: AGENT_PROFILE,
  scopes: ['user', 'project'],
  merge: 'replace',
});

export const openLinks = settingKey({
  id: 'browser.openLinks',
  order: 120,
  title: 'Open links in the built-in browser',
  description:
    'Which browser is the place beside your work for a link to a site. On, a click on such a link in a thread, a document or a terminal opens it in the active tab of the built-in browser in the area beside, and the right-click menu offers a new browser tab. Off, the click opens your system browser. ⌘-click (Ctrl elsewhere) always opens the system browser; links.click swaps the click and the ⌘-click.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: ['user', 'project'],
  merge: 'replace',
});

export const BROWSER_SETTINGS = [userProfile, agentProfile, openLinks] as const;

export const BROWSER_SETTING_SECTIONS = [
  {
    id: 'browser',
    order: 140,
    title: 'Browser',
    description: 'The browser built into Tagma: profiles, which profile your pages and agent pages open in, and where links open.',
  },
] as const;
