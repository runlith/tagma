export const DESCRIPTION_READ = `Read a text file, a PNG, JPEG, GIF or WebP image, or a PDF, or list a directory. An image reaches you as the picture itself; a PDF as its text page by page, windowed by \`pages\`, with a page that has no text layer shown as a picture. Missing paths are refused.

- Use an absolute path supplied by the user or graph, returned by a tool, or resolved from a read import. Never invent a path from a symbol; discover it with \`grep\` (content) or \`glob\` (filename).
- Reads up to 2000 lines by default; \`offset\` is 1-indexed. When you already know which part of the file you need, only read that part. This can be important for larger files.
- Results are returned using cat -n format: the line number, a tab, the line. Lines over 2000 characters are truncated. A footer appears only when the file was cut, naming the offset that continues.
- Directories return one name per line sorted by name, with \`/\` on subdirectories, and their count; a cut listing adds a cursor: repeat the call with it to continue.
- Do NOT re-read a file you just edited to verify — edit and write refuse when the change fails.
- Read independent files in parallel.`;

export const DESCRIPTION_WRITE = `Create or overwrite a file. Pass exactly one of \`content\` or \`fromFile\`; the latter is read at call time and can reuse content saved by a refusal.
Read an existing file first. For partial changes, use \`edit\` so concurrent edits are not overwritten.`;

export const DESCRIPTION_DELETE = `Remove files, glob matches and directory trees in one call, with attribution for files in registered checkouts. Pass rm-style argv in args: ["-rf", "--", "dist", "build"]. Supports -r/-R/--recursive, -f/--force, -d/--dir, -v/--verbose, --one-file-system and --preserve-root[=all]/--no-preserve-root; interactive options are refused.
The answer counts every entry and gives one result per named path with how much of its tree was removed, plus every failed or skipped entry; -v adds one result per entry. A tree is walked when it is removed: what stands in it then goes.
Glob expansion is on by default: *, ?, classes, ** and brace alternatives; hidden segments require an explicit dot. Set glob:false for literal names containing metacharacters. Relative operands use workdir, or the workspace by default. JSON strings delimit operands; no shell is executed.
Use this for removal instead of rm, including large batches and ignored files. Symlinks are unlinked without changing their targets. -f tolerates absence, not filesystem errors. Partial failures and cancellation preserve completed actions and the remaining paths; a large report is retained for reading without repeating deletion.
Delete only entries you created or the user asked to delete. Prefer edit to deleting and rewriting.`;

export const DESCRIPTION_RENAME = `Move one regular text file, preserving bytes and mode. Supports case-only renames on case-folding filesystems.
Both paths must stay inside the workspace; absolute and workspace-relative paths are accepted. Existing destinations, directories, symlinks, sockets and binary sources are refused. Use this instead of deleting and recreating the file.`;

export const DESCRIPTION_EDIT = `Replace exact text in a file. Read it first; preserve whitespace and line endings, but omit the line number and tab that prefix each line of \`read\` output.
No match, multiple matches or identical old/new text are errors. For multiple matches, provide more context or set \`replaceAll\` to replace every occurrence.`;

export const DESCRIPTION_GLOB = `Find files by glob pattern, e.g. "**/*.js" or "src/**/*.ts". Returns paths sorted by modification time. Answers a page; the footer carries the total and the cursor that continues the walk. Batch independent searches.`;

export const DESCRIPTION_GREP = `Content search built on ripgrep. Prefer this over \`grep\`/\`rg\` through \`bash\`: the places it finds deliver their law and notes.

- Full regex syntax (e.g. "log.*Error", "function\\s+\\w+"). Ripgrep, not grep — escape literal braces (\`interface\\{\\}\`).
- Filter with \`glob\` (e.g. "**/*.tsx") or \`type\` (e.g. "js", "py", "rust").
- \`output_mode\`: "content" (matching lines as \`path:line:text\`, with \`before\`/\`after\`/\`context\` lines as \`path-line-text\`), "files_with_matches" (paths only, default), or "count". Files come newest first. The lines around a match often answer what a \`read\` would.
- \`multiline: true\` for patterns that span lines.
- The answer ends with its total in parentheses; a cut answer adds a cursor: repeat the call with that cursor added to continue.`;

const SHELL_STANDING_RULES = `Use for terminal operations (git, builds, tests, etc.). Read, write, edit, rename and delete files with the dedicated file tools, never with python, sed, perl, cat or a redirect: only their writes are attributed to you. Use delete for removal, including lists, globs and directory trees. A command writes files only for a change across tens of files, a generator or a formatter.
Search with the \`grep\` and \`glob\` tools, never with shell \`grep -r\`, \`find\` or \`ls -R\`: those walk every tree git ignores — dependencies, build output, vendored checkouts — and take minutes where the tools take under a second. A search the tools cannot express goes through \`rg\`, which skips ignored paths too.
Calls of one step keep their order where they touch the same things: a command that only reads waits for earlier writes; any other command waits for every call before it, and every call after it waits for its answer.`;

export function shellDescription(runtime: {
  readonly platform: string;
  readonly shell: string;
  readonly workspace: string;
  readonly fenced: boolean;
  readonly tmp: string;
  readonly maxLines: number;
  readonly maxBytes: number;
  readonly managed: boolean;
}): string {
  return [
    `Runs one command through ${runtime.shell} on ${runtime.platform} and returns its output as text: the last ${runtime.maxLines} lines and ${Math.round(runtime.maxBytes / 1024)} KB, with a non-zero exit status reported.`,
    runtime.fenced
      ? `Commands run in ${runtime.workspace}; \`workdir\` (never \`cd\`) must stay inside it. Temporary work goes to \`${runtime.tmp}\`.`
      : `Commands run in ${runtime.workspace}; \`workdir\` (never \`cd\`) may name any directory on this machine. Temporary work goes to \`${runtime.tmp}\`.`,
    SHELL_STANDING_RULES,
    runtime.managed
      ? `A command has a wait and a life. The wait (\`waitMs\`) is how long this call holds it; when it passes, the command moves to the background unharmed and its result arrives as a notice — never run it again or wait for it with sleep. The life (\`lifeMs\`) is how long it may run at all, here or in the background; when it runs out, the command is killed and a notice says so. Hold work whose result you need now; start with \`waitMs: 0\` work whose result you need later, instead of a trailing \`&\`, which leaves a program running unwatched; a process that must keep living, such as a server or a watcher, is a terminal (start_terminal). Command rules the user wrote may shorten either.`
      : 'A command lives only as long as its call: it is killed when its wait (`waitMs`) or its life (`lifeMs`) passes, whichever comes first, and `waitMs: 0` is refused.',
  ].join('\n');
}

export const DESCRIPTION_WEBFETCH = `Fetch an absolute HTTP(S) URL as Markdown (default), text, or HTML. URLs are fetched as given; HTTP is not upgraded to HTTPS. No files are modified; large results may be summarized.
A redirect inside the same origin is followed; one that leaves it REFUSES and names where it would have gone, so call this again with that address — the destination reached is the one that was allowed, and each new origin is allowed on its own. The grain is the origin (scheme, host, port), not the path.
Prefer a more suitable fetching tool when available. Use \`websearch\` to find information without a known URL.`;

export const DESCRIPTION_WEBSEARCH = `Search the web and retrieve relevant page content. Use \`webfetch\` for a known URL.
Search types: auto (balanced), fast, deep (comprehensive). Live crawling: fallback (when cached content is unavailable) or preferred (prioritize live content). Result count and context length are configurable.
The current year is {{year}}. Use it in queries for recent information or current events.`;
