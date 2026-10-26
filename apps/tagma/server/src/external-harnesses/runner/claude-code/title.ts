import { homedir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const NEWLINE = 0x0a;

export class SessionTitle {
  private offset = 0;
  private custom: string | null = null;
  private generated: string | null = null;
  private told: string | null = null;
  private readonly path: string;

  constructor(
    id: string,
    cwd: string,
    private readonly stderr: (text: string) => void,
  ) {
    const home = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
    this.path = join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);
  }

  fresh(): Effect.Effect<string | null> {
    return Effect.promise(() => this.scan());
  }

  private async scan(): Promise<string | null> {
    const file = Bun.file(this.path);
    try {
      if (!(await file.exists()) || file.size <= this.offset) return null;
      const bytes = new Uint8Array(await file.slice(this.offset, file.size).arrayBuffer());
      const end = bytes.lastIndexOf(NEWLINE);
      if (end < 0) return null;
      this.offset += end + 1;
      for (const line of new TextDecoder().decode(bytes.subarray(0, end)).split('\n')) this.read(line);
    } catch (cause) {
      this.stderr(`the session title of ${this.path} could not be read: ${String(cause)}\n`);
      return null;
    }
    const title = this.custom ?? this.generated;
    if (title === null || title === this.told) return null;
    this.told = title;
    return title;
  }

  private read(line: string): void {
    if (!line.includes('-title"')) return;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof row !== 'object' || row === null) return;
    const entry = row as Record<string, unknown>;
    if (entry.isSidechain === true) return;
    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string' && entry.aiTitle !== '') this.generated = entry.aiTitle;
    if (entry.type === 'custom-title' && typeof entry.customTitle === 'string' && entry.customTitle !== '') this.custom = entry.customTitle;
  }
}
