export const DICTATION = {
  arm: 'dictation:arm',
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
  command: 'tabs:command',
  closeWindow: 'tabs:close-window',
} as const;

export const SWIPE = {
  phase: 'swipe:phase',
  swiped: 'swipe:swiped',
} as const;

export const FOLDERS = {
  choose: 'folders:choose',
} as const;

export const BROWSER = {
  host: 'browser:host',
  show: 'browser:show',
  hide: 'browser:hide',
  elsewhere: 'browser:elsewhere',
  keys: 'browser:keys',
  key: 'browser:key',
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
