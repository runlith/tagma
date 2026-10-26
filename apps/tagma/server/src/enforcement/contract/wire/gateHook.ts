import { OWN_GIT_VARIABLE } from '../../../platform/contract/service/credentials.js';

export const MARK = '# tagma commit gate';

export const OWNER_LINE = '# tagma gate owner ';

export type GateStanding = 'not-ours' | 'mine' | 'vanished' | 'foreign';

export const gateStanding = (text: string, owner: string, alive: (owner: string) => boolean): GateStanding => {
  const [, mark, line] = text.split('\n', 3);
  if (mark !== MARK) return 'not-ours';
  if (line === undefined || !line.startsWith(OWNER_LINE)) return 'vanished';
  const named = line.slice(OWNER_LINE.length);
  if (named === owner) return 'mine';
  return alive(named) ? 'foreign' : 'vanished';
};

export const CHAINED = '.tagma-chained';

export const OWN_EXIT = `[ -n "$${OWN_GIT_VARIABLE}" ] && exit 0`;

export const chaining = (hook: string, carry: string): string =>
  [
    `chained="$(dirname "$0")/${hook}${CHAINED}"`,
    'if [ -x "$chained" ]; then',
    '  shell() {',
    '    [ "${1##*/}" = env ] && shift && [ "$1" = -S ] && shift',
    '    case "${1##*/}" in sh|dash|ash) shift ;; *) return 1 ;; esac',
    '    for flag do case "$flag" in -|--*|[!-]*) return 1 ;; esac; done',
    '  }',
    '  run=; IFS= read -r run < "$chained"',
    '  case "$run" in "#!"*) run=${run#??} ;; *) run= ;; esac',
    `  if shell $run; then TAGMA_CHAINED="$chained" $run -c '. "$TAGMA_CHAINED"' "$0" "$@"; else "$chained" "$@"; fi${carry}`,
    'fi',
  ].join('\n');

export const passesOwnGit = (hook: string, text: string): boolean => {
  const [shell, mark, owner, ...rest] = text.split('\n');
  return (
    shell === '#!/bin/sh' &&
    mark === MARK &&
    owner?.startsWith(OWNER_LINE) === true &&
    ['', ' || exit $?'].some((carry) => {
      const head = `${chaining(hook, carry)}\n${OWN_EXIT}`;
      return rest.slice(0, head.split('\n').length).join('\n') === head;
    })
  );
};
