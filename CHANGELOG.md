# Changelog

## 0.9.7
- Smooth zooming: the wheel sets a target and the camera eases to it, so zoom stays fluid even when frames are slow.
- Neurons and signals have a maximum size on screen: close up they used to grow to hundreds of pixels each, with
  additive blending, which made zooming in very heavy.
- Auto quality knows the GPU: it reads what kind it is (dedicated, integrated, software) to choose where to start,
  measures the real GPU time per frame where the browser allows it, and keeps a quality at which dragging and
  zooming run at 60 fps (stepping back up, at most once a minute, when there is plenty of room). Without a GPU
  (software rendering) the glow is turned off.
- While you drag or zoom, a GPU that cannot keep 60 fps gets an even 30 instead of a stuttering rate.
- The composer's unused second buffer is kept at 1×1 pixel: less video memory.
- The Info panel (I) shows the GPU, the render scale, the antialiasing and the GPU time per frame.

## 0.9.6
- Fixes the fast flicker in 0.9.5: the post-processing swapped its two buffers after every frame, and only one of them
  was antialiased, so every other frame came out with jagged edges. The scene now always goes into the same
  multisampled buffer.

## 0.9.5
- Much lighter on the GPU:
  - Adaptive frame rate (new default): 60 fps only while you drag, zoom, replay or inspect; 30 fps for the slow ambient
    motion; 20 fps while Obsidian is in the background; never above 60 on 120/144 Hz screens.
  - Only the scene buffer is multisampled (the second buffer and the canvas no longer are), which halves the video
    memory; the bloom runs at half its former resolution.
  - Spike buffers upload only the points in use each frame.
  - Auto quality starts at 1.5x at most, drops the antialiasing before the resolution, and remembers where it settled.
- No more blinks: opening a panel or changing quality no longer clears the canvas for a frame, and auto quality no
  longer steps up and down (each step reallocated the buffers).
- If the GPU drops the WebGL context (driver reset, out of video memory), the view rebuilds itself when it comes back.

## 0.9.4
- First release built by GitHub Actions from `package-lock.json`, with build-provenance attestations. Same plugin as
  0.9.3.

## 0.9.3
- Releases carry only `main.js`, `manifest.json` and `styles.css`. The anatomy files moved to their own release
  (`anatomy-1`), still downloaded once and checked by SHA-256.
- Built with esbuild from a lockfile (`npm ci && npm run build`), so anyone can rebuild a release and compare; releases
  are built by GitHub Actions and carry build-provenance attestations.
- `LICENSE` is the plain MIT text again, so GitHub and the plugin directory recognise it; the scope notes (data in
  `assets/`, trademarks) are in `THIRD_PARTY_NOTICES.md` and the README.
- Styles: no `!important`, no CSS masks, no scrollbar styling (all flagged by the directory's checks).
- README: a disclosures table (network, local server, files outside the vault, vault files, clipboard).

## 0.9.2
- Sharper picture: the scene is now drawn with 4x multisample antialiasing (the canvas's own antialiasing never applied,
  since everything goes through the bloom pass), so gyri, fibres and outlines no longer show jagged edges.
- Auto quality starts at your screen's full resolution, never drops below it (it used to go down to 0.8x, which looked
  blurry and blocky), and steps back up once frames are fast again. New "Maximum" setting: above screen resolution
  with 8x antialiasing.

## 0.9.1
- The project now lives at https://github.com/mucahitkumlay/agent-brain (the old address redirects). The anatomy files
  are fetched from releases there.
- CI uses only GitHub's own actions (Bun comes from npm), with read-only permissions for the test workflow.

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
