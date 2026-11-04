import type { AgentSkill } from '@runlith/agent/AgentSkill';

const INSTRUCTIONS = `# Agent definitions

An agent definition is a Markdown file \`<name>.md\`; \`<name>\` is the type id a thread is started as. A change applies to the next thread and preview; \`refresh_thread_instructions\` rebuilds an existing thread from its current definition for the next run. A run already going keeps the instructions it opened with.

## Where they live and who may start them

- **Personal**: \`agents/\` in the Tagma server's data directory. Offered to agents by default.
- **Project**: \`.agents/\` at the project root. Offered to the operator alone by default.
- **App**: \`<app>.<agent>\`, shipped by a Tagma app, read-only, only where the app is enabled. Offered to the operator alone by default.
- **Plugin**: \`<plugin>-<agent>\`, an agent file of an installed plugin, read-only, only where the plugin is enabled; the tools it names are its whitelist. Offered to the operator alone by default.

\`read_agent_library\` answers both directories as \`floors\`, every definition with its origin, the files it rejected and why, and the capability ids. The setting \`agent.offered\` overrides the default per type: entries \`{"type": "<name>", "to": "operator" | "agents"}\`, the later entry winning; it is the operator's to write. A type withheld from agents refuses \`type-withheld\`. A name cannot reuse a built-in agent or harness id; a personal file shadows a project file of the same name.

## The file

\`\`\`markdown
---
description: One line shown in the spawn menu.
extends: tagma            # a built-in agent id; omitted, the agent stands alone
capabilities: [files, web] # narrows what extends holds; required without extends, [] selects none
tools: [read, ls, webfetch] # optional allowlist of tool names inside those capabilities
# conversation tools (ask_user, read_tool_output, tool_search) stay whatever these two say
model: { provider: anthropic, model: claude-sonnet-5-5, reasoning: high } # optional start model
audience: reader           # optional: graph | executor | reader; unset, graph for a graph holder, else executor
budget: { prompt: 90000, steps: 25, seconds: 180 } # optional bounds of a run; each field optional
sections:                  # optional edits of the inherited prompt, applied in order
  - drop: holding-a-position
  - keep: [preamble]        # or: drop every section but these
  - replace: answering
    text: Answer in one paragraph.
  - add: review-lens
    after: deciding         # or before
    text: "## Review lens\\nCheck correctness first."
  - edit: writing
    find: Short by default.
    with: Terse by default.
---
Body.
\`\`\`

- With \`capabilities\` listed, a name in \`tools\` that no held capability could offer in any world refuses \`agent-invalid\`, naming the capability that offers it; a name the current world merely lacks is kept. \`files\` offers read, write, edit, delete, rename, ls; \`shell\` bash, grep, glob; \`web\` webfetch, websearch; \`graph\` the graph tools; \`read_agent_library\` lists every capability's tools. A held capability with runtime sources (\`mcp\`) can still bring names at birth, so with one held nothing is refused.
- \`audience: reader\` is for a thread that answers and changes nothing: it is told no law, vocabulary or map, and on a read only the explanations over the file. \`budget\` binds a thread born from the definition: at 70% of any bound it is guided, and at a bound its remaining calls are denied and it answers on one last step. An unset \`prompt\` takes the model's price step where it has one. The built-in \`reader\` definition (read tools, graph first, steps 25, seconds 180) answers one question with its evidence.
- With \`extends\` the body is appended after the inherited prompt as the section \`overlay\`, and may be empty. Without it the body is the agent's identity and must not be empty.
- Section ids are those \`read_agent\` prints under \`prompt.sections[].id\`, except \`overlay\` and \`collaboration-source\`, which are added after the edits. \`find\` must stand exactly once in its section. An edit whose section or passage is gone refuses \`agent-invalid\` at \`read_agent\` and fails the thread's first run; sections differ by project and capabilities, so preview in the project that will run it.

## Workflow

1. Write the draft into scratch and preview it: \`read_agent {sourceFile, id}\`. The answer carries the composed prompt, its section ids and the held capabilities; check them.
2. Save: \`save_agent {name, scope: "personal" | "project", sourceFile, revision}\` — \`revision: null\` creates, the revision last read replaces, a stale one refuses \`agent-changed\`.
3. Start it: \`spawn_agent {agentId: "<name>", task}\`. \`plain: true\` makes a native child hear its parent as the operator, with no envelope or team in its prompt; it is used only on the operator's word.
`;

export function agentDefinitionsSkill<TContext>(): AgentSkill<TContext> {
  return {
    id: 'agent-definitions',
    description:
      'Create or change an agent definition: where personal, project, app and plugin agents live and who may start each, the Markdown format (extends, capabilities, tools, model, section edits, body), previewing with read_agent, saving with save_agent and starting it by id. Load before writing or editing any agent definition.',
    instructions: () => INSTRUCTIONS,
  };
}
