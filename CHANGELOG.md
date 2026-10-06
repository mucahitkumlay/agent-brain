# Changelog

## 0.9.0
- Renamed from Claude Brain to **Agent Brain** (plugin id `agent-brain`). It works with Claude Code for now; the name
  no longer uses Anthropic's trademark. Settings carry over when you move `data.json` (see the README).
- Listener hardening: requests that look like they come from a web page (web `Origin`, `Sec-Fetch-Site`, a foreign
  `Host` from DNS rebinding) are refused.
- Security invariants checked by tests.
- README: responsible use, a per-file licence table, redistribution duties, trademarks, no-warranty and not-medical
  notes. The release `main.js` carries a licence banner.
- Call inspector: click a signal (or an event in a session) for everything about that call: every parameter, who ran
  it (main agent or subagent, the agent chain and the call that started it), why (its description, what Claude said just
  before, the plan step, the agent's task, your prompt), where it goes (files, URLs, hosts, MCP server, each program of a
  pipeline, files it writes) and where it lands in the brain and why, its output and the raw hook events, with copy
  buttons. Kept in memory only; Settings → Inspector turns it off.
- The operation tree is a tab of the inspector; click a line for its details, ↻ to replay it.
- Atlas look (V, or the layers menu): a see-through brain where neurons, synapses and signals stand out, tinted by region.
- The hover tip shows the command or path a signal carries.
- Demo calls carry ids, prompts and output, so the inspector has something to show.
- Settings: headings use Obsidian's setting headings; README states network use and the one file outside the vault.

## 0.8.0
- Freeze time (Space) and slow motion; point at any signal to see what it carries, click it for the operation tree of
  its turn; replay any line of the tree.
- Energy from Claude Code telemetry (OpenTelemetry logs): model calls, tokens, cache, cost, working memory.
- Stuck detection: repeated failures, re-running unchanged commands, edit loops, API errors, long-running commands,
  no progress.
- Sleep replay when idle; EEG-style traces per region; region memory (click a gyrus or nucleus).
- Anatomy rebuilt from the ICBM152 2009 template only (T1 slices and ventricles).

## 0.7.0
- All Claude Code hook events; signals travel along real fibre bundles; one signal per command of a shell chain;
  results travel back; thinking loops; engram trace; MessageDisplay (Broca's area); body signals (CPU, memory, network,
  disk); MRI slices with diffusion-style fibres; installer for local hooks.

## 0.6.0
- Full anatomy: AAL gyri, deep nuclei and ventricles, HCP-1065 tracts, MRI slices.

## 0.5.x and earlier
- Live view of sessions, subagents and workflows; timeline with replay; daily note; learned connections; servers through
  an SSH tunnel with an offline queue; minimal HUD; mini view.
