export const DICTATION = {
  state: 'dictation:state',
  changed: 'dictation:changed',
  prompt: 'dictation:prompt',
  stroke: 'dictation:stroke',
  ready: 'dictation:ready',
  lost: 'dictation:lost',
  keep: 'dictation:keep',
  paste: 'dictation:paste',
  show: 'dictation:show',
} as const;

export const TABS = {
  closeWindow: 'tabs:close-window',
} as const;

export const KEYS = {
  publish: 'keys:publish',
  press: 'keys:press',
  kept: 'keys:kept',
  answers: 'keys:answers',
  answered: 'keys:answered',
  owned: 'keys:owned',
  perform: 'keys:perform',
} as const;

export const UPDATES = {
  check: 'updates:check',
  take: 'updates:take',
} as const;

export const SWIPE = {
  phase: 'swipe:phase',
  swiped: 'swipe:swiped',
} as const;

export const FOLDERS = {
  choose: 'folders:choose',
} as const;

export const APPEARANCE = {
  follow: 'appearance:follow',
} as const;

export const BROWSER = {
  host: 'browser:host',
  show: 'browser:show',
  hide: 'browser:hide',
  freeze: 'browser:freeze',
  elsewhere: 'browser:elsewhere',
  find: 'browser:find',
  stopFind: 'browser:stop-find',
  found: 'browser:found',
  zoom: 'browser:zoom',
  devtools: 'browser:devtools',
  capture: 'browser:capture',
  identity: 'browser:identity',
  chooseIdentity: 'browser:choose-identity',
} as const;

export const SURFACE = {
  current: 'surface:current',
  use: 'surface:use',
} as const;

export const DEV_SURFACE_ARGUMENT = '--tagma-dev-surface';

export const WINDOWS = {
  open: 'windows:open',
  openProject: 'windows:open-project',
  reveal: 'windows:reveal',
  revealed: 'windows:revealed',
} as const;
