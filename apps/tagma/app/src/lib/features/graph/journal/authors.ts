import type { JournalSession } from '@tagma/server/graph/contract/wire/journal';
import { NATIVE_HARNESS, type SessionIdentity, sessionName } from '@tagma/server/platform/contract/wire/session';

export function authorName(session: JournalSession | null | undefined, identity: SessionIdentity['Service']): string {
  if (session === null) return 'Operator';
  if (session === undefined) return 'Unknown session';
  if (session.harness !== NATIVE_HARNESS) return sessionName(session, identity);
  return session.name || session.title?.trim() || sessionName(session, identity);
}
