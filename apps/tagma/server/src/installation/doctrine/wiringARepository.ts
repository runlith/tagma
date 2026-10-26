import type { Section } from '../../platform/contract/wire/section.js';

export const wiringARepository: Section = () => `## Wiring a Repository, and Keeping It Wired

Registering a repository, planting Tagma into it and refreshing what already stands are the
OPERATOR's acts, not operations on a graph. What an agent needs is what they mean.

- **One project per repository.** Any place inside a repo registers the repo itself, and a second
  registration of the same root refuses. Products inside a monorepo are regions of the one graph —
  blocks whose \`dir\` sources draw their code — read through a scope, never separate projects.
- **Planting writes three things**: the managed law into the repository's agent file, the skill where
  its harness looks, and a session hook so every session and every compaction starts primed.
- **The project block's own body is written first.** The orientation prints it before anything else,
  and a session that opens on an empty one has to guess what the product even is.
- **An installed surface is refreshed, never edited.** One act brings every place Tagma already stands
  up to what the running server ships; a hand copy silently forks and the next refresh overwrites it.
  The source of an installed text is the server's shipment, so a change reaches installations when a
  server built from it refreshes them.
- **The server is one process** answering on one port. It is not
  restarted to make a change take effect unless the operator says so: every agent's calls go through
  it, and it holds other conversations' work.
`;
