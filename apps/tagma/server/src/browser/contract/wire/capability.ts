import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const browserCapability = {
  id: 'browser',
  description: 'pages of the browser built into Tagma: opening, reading, acting on, capturing and debugging them, and its profiles',
  guide:
    'A web page you must see or act on — a dev server, an app behind a sign-in, a page that runs script — opens in the browser built into Tagma with `open_page`, where the operator sees it beside the thread and can step in; a browser started from the shell stays for what tool calls are too slow for, such as a burst of frames. `snapshot_page` reads a page as an accessibility tree whose references, like `e12`, `act_on_page` takes, as it takes the reference of an element the operator picked into the message; `capture_page` shows how it looks.',
  cue: { tool: 'bash', input: 'command', matches: 'playwright|puppeteer|chromium|google-chrome|--headless' },
  sections: ['browser-pages'],
  joins: ['tagma'],
} as const satisfies CapabilityDeclaration;
