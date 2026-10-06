# Changelog

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
