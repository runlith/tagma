const PROBE_MS = 10_000;

const reached = new Map<string, Promise<boolean>>();

export function reaches(page: URL): Promise<boolean> {
  const standing = reached.get(page.origin);
  if (standing !== undefined) return standing;
  const asked = fetch(page, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(PROBE_MS) }).then(
    () => true,
    () => false,
  );
  reached.set(page.origin, asked);
  void asked.then((answered) => {
    if (!answered) reached.delete(page.origin);
  });
  return asked;
}
