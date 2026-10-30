import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

type Held = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Held => Predicate.isObject(value) && !Array.isArray(value);

const CLAUDE_CODE_MARK =
  '<svg width="24" height="24" viewBox="0 0 16 16" fill="none" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">\n<path fill-rule="evenodd" d="M2 3h12v7H2zM0 5h2v2H0zM14 5h2v2h-2zM3 10h1v3H3zM5 10h1v3H5zM10 10h1v3h-1zM12 10h1v3h-1zM5 5h1v2H5zM10 5h1v2h-1z" fill="currentColor"/>\n</svg>';

const CURSOR_MARK =
  '<svg width="24" height="24" viewBox="67 67 378 378" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m415.348 156.575-151.504-87.4699c-4.865-2.8094-10.868-2.8094-15.733 0l-151.4964 87.4699c-4.0897 2.361-6.6146 6.728-6.6146 11.458v176.383c0 4.73 2.5249 9.097 6.6146 11.459l151.5034 87.469c4.865 2.81 10.868 2.81 15.733 0l151.504-87.469c4.09-2.362 6.615-6.729 6.615-11.459v-176.383c0-4.73-2.525-9.097-6.615-11.458zm-9.517 18.528-146.254 253.319c-.989 1.707-3.599 1.01-3.599-.967v-165.871c0-3.314-1.771-6.38-4.645-8.044l-143.644-82.932c-1.707-.989-1.01-3.599.967-3.599h292.51c4.153 0 6.749 4.502 4.672 8.101h-.007z" fill="currentColor"/></svg>';

const GEMINI_MARK =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M12 2C12.6 7.2 16.8 11.4 22 12C16.8 12.6 12.6 16.8 12 22C11.4 16.8 7.2 12.6 2 12C7.2 11.4 11.4 7.2 12 2Z" fill="currentColor"/>\n</svg>';

const OPENCODE_MARK =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4h12v16H6V4Zm3 3v10h6V7H9Z" fill="currentColor"/></svg>';

const PRESENTATIONS: Readonly<Record<string, Held>> = {
  'claude-code': {
    label: 'Claude Code',
    iconProvider: 'claude-code',
    mark: CLAUDE_CODE_MARK,
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    modelProvider: 'claude-code',
    terminal: true,
    acp: true,
    hosted: true,
    sharedSessions: true,
  },
  codex: {
    label: 'Codex',
    iconProvider: 'codex',
    mark: null,
    install: 'npm install -g @openai/codex',
    modelProvider: 'codex',
    terminal: true,
    acp: false,
    hosted: false,
    sharedSessions: true,
  },
  grok: {
    label: 'Grok Build',
    iconProvider: 'xai',
    mark: null,
    install: null,
    modelProvider: null,
    terminal: true,
    acp: false,
    hosted: false,
    sharedSessions: true,
  },
  devin: {
    label: 'Devin',
    iconProvider: 'devin',
    mark: null,
    install: null,
    modelProvider: 'devin',
    terminal: true,
    acp: true,
    hosted: false,
    sharedSessions: true,
  },
  cursor: {
    label: 'Cursor',
    iconProvider: null,
    mark: CURSOR_MARK,
    install: 'curl https://cursor.com/install -fsS | bash',
    modelProvider: null,
    terminal: true,
    acp: true,
    hosted: true,
    sharedSessions: false,
  },
  gemini: {
    label: 'Gemini CLI',
    iconProvider: null,
    mark: GEMINI_MARK,
    install: 'npm install -g @google/gemini-cli',
    modelProvider: null,
    terminal: true,
    acp: false,
    hosted: false,
    sharedSessions: true,
  },
  opencode: {
    label: 'OpenCode',
    iconProvider: null,
    mark: OPENCODE_MARK,
    install: null,
    modelProvider: null,
    terminal: true,
    acp: true,
    hosted: true,
    sharedSessions: false,
  },
};

export const harnessPresentationForm: ThreadFormStep = {
  name: '20261030160000_harness_presentation',
  samples: {
    meta: { external: { facet: { name: 'claude-code', sessionKey: null } } },
  },
  meta: (meta) => {
    const external = meta.external;
    if (!isRecord(external) || !isRecord(external.facet) || external.facet.presentation !== undefined) return null;
    const presentation = typeof external.facet.name === 'string' ? PRESENTATIONS[external.facet.name] : undefined;
    return presentation === undefined ? null : { ...meta, external: { ...external, facet: { ...external.facet, presentation } } };
  },
};
