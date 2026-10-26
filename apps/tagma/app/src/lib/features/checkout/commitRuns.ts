export type CommitEntry = {
  readonly sha: string;
  readonly subject: string;
  readonly author: string;
  readonly date: string;
  readonly files?: number;
  readonly graph?: boolean;
};

export type CommitRun =
  | { readonly kind: 'commit'; readonly key: string; readonly commit: CommitEntry }
  | { readonly kind: 'graph'; readonly key: string; readonly commits: readonly CommitEntry[] };

export function commitRuns(commits: readonly CommitEntry[], foldGraph: boolean): readonly CommitRun[] {
  const runs: CommitRun[] = [];
  let pending: CommitEntry[] = [];
  const flush = (): void => {
    const first = pending[0];
    if (first === undefined) return;
    if (pending.length === 1) runs.push({ kind: 'commit', key: first.sha, commit: first });
    else runs.push({ kind: 'graph', key: `graph:${first.sha}`, commits: pending });
    pending = [];
  };
  for (const commit of commits) {
    if (foldGraph && commit.graph === true) {
      pending.push(commit);
      continue;
    }
    flush();
    runs.push({ kind: 'commit', key: commit.sha, commit });
  }
  flush();
  return runs;
}
