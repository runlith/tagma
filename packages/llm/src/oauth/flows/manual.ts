export type ManualOAuthStart = {
  authorizeUrl: string;
  verifier: string;
  state: string;
};

export function parseManualRedirect(input: string): { code: string; state?: string } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Authorization input is empty');
  if (trimmed.includes('://') || trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
    let url: URL;
    try {
      url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    } catch {
      throw new Error('Pasted redirect URL is not a valid URL');
    }
    const code = url.searchParams.get('code');
    if (!code) throw new Error('Pasted redirect URL has no code parameter');
    return { code, state: url.searchParams.get('state') ?? undefined };
  }
  return { code: trimmed };
}
