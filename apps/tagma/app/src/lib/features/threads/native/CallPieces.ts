import type { Piece } from '@tagma/server/speech/contract/wire/listening';
import type { ThreadsRepo } from '../Repo.js';

type Threads = ReturnType<typeof ThreadsRepo.use>;

export class CallPieces {
  constructor(
    private readonly threads: Threads,
    private readonly projectId: number,
  ) {}

  async file(piece: Piece): Promise<File | null> {
    const read = await this.threads.pieceText.run({ piece }, { throwOnError: true });
    if (read === undefined || read.lines === 0) return null;
    return new File([read.text], 'call.md', { type: 'text/markdown' });
  }

  async give(piece: Piece, threadId: string): Promise<void> {
    await this.threads.givePiece.run({ piece, thread: { id: threadId, projectId: this.projectId } }, { throwOnError: true });
  }
}
