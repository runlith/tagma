export function tokensFigure(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

export function clockFigure(at: string): string {
  return `${new Date(at).toISOString().slice(11, 16)}Z`;
}
