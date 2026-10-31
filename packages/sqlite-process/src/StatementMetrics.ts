export type StatementCounts = {
  readonly fingerprint: string;
  readonly summary: string;
  statements: number;
  programStatements: number;
  completed: number;
  failed: number;
  totalMs: number;
  queueMs: number;
  execMs: number;
};

const TEXTS = 4096;
const FINGERPRINTS = 1024;
const TEXT_UNITS = 2 * 1024 * 1024;
const MAX_TEXT_UNITS = 16_384;

const counts = (fingerprint: string, summary: string): StatementCounts => ({
  fingerprint,
  summary,
  statements: 0,
  programStatements: 0,
  completed: 0,
  failed: 0,
  totalMs: 0,
  queueMs: 0,
  execMs: 0,
});

export class StatementMetrics {
  private readonly texts = new Map<string, StatementCounts>();
  private readonly fingerprints = new Map<string, StatementCounts>();
  private readonly overflow = counts('overflow', 'SQL outside the bounded fingerprint census');
  private textUnits = 0;

  query(sql: string): StatementCounts {
    const known = this.texts.get(sql);
    if (known !== undefined) return known;
    if (sql.length > MAX_TEXT_UNITS || this.texts.size >= TEXTS || this.textUnits + sql.length > TEXT_UNITS) return this.overflow;
    const normalized = sql
      .replace(
        /"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|(?:\s|--[^\r\n]*|\/\*[\s\S]*?\*\/)+|'(?:''|[^'])*'|\?\d*|[:@$]\w+|\b(?:0x[\da-f]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?)\b/gi,
        (token) => (/^["`\[]/.test(token) ? token : /^\s|^--|^\/\*/.test(token) ? ' ' : '?'),
      )
      .trim();
    const fingerprint = Bun.hash(normalized).toString(16);
    let row = this.fingerprints.get(fingerprint);
    if (row === undefined) {
      if (this.fingerprints.size >= FINGERPRINTS) return this.overflow;
      row = counts(fingerprint, normalized.slice(0, 512));
      this.fingerprints.set(fingerprint, row);
    }
    this.texts.set(sql, row);
    this.textUnits += sql.length;
    return row;
  }

  read(input: { readonly limit: number }) {
    const rows = [...this.fingerprints.values(), this.overflow]
      .filter((row) => row.statements + row.programStatements > 0)
      .sort((a, b) => b.statements + b.programStatements - a.statements - a.programStatements);
    return { rows: rows.slice(0, input.limit).map((row) => ({ ...row })), total: rows.length };
  }
}
