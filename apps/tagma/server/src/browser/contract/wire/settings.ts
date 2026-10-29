import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';
import { AGENT_PROFILE, ProfileId, USER_PROFILE } from './ids.js';
import { DomainPattern } from './domains.js';

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

export const blockedDomains = settingKey({
  id: 'browser.blockedDomains',
  order: 130,
  title: 'Blocked domains for agents',
  description:
    'Agent navigation cannot load these domains, including redirects, frames and popups. Use example.com for that host or *.example.com for its subdomains. Blocked wins over allowed. Your own navigation is unrestricted; page fetches and other subresources are outside these lists.',
  schema: Schema.Array(DomainPattern),
  fallback: [],
  scopes: ['user', 'project'],
  merge: 'replace',
});

export const allowedDomains = settingKey({
  id: 'browser.allowedDomains',
  order: 140,
  title: 'Allowed domains for agents',
  description:
    'Empty allows any domain not blocked. With entries, agent navigation may load only these hosts: example.com matches that host, *.example.com its subdomains. A project list replaces your user list, including an empty project list.',
  schema: Schema.Array(DomainPattern),
  fallback: [],
  scopes: ['user', 'project'],
  merge: 'replace',
});

export const BROWSER_SETTINGS = [userProfile, agentProfile, openLinks, blockedDomains, allowedDomains] as const;

export const BROWSER_SETTING_SECTIONS = [
  {
    id: 'browser',
    order: 140,
    title: 'Browser',
    description: 'The built-in browser: profiles, where links open, and the domains agents may navigate to.',
  },
] as const;
