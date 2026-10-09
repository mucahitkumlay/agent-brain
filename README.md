# Agent Brain

**Watch your AI coding agent work, live, on a real brain.** An Obsidian plugin that shows every agent session (prompts,
thinking, tool calls, subagents, results) as activity on an MRI-derived brain, and your vault as its neurons and links.
It only listens on your own computer and never calls a model, so it uses no tokens.

> **Works with [Claude Code](https://docs.claude.com/en/docs/claude-code) for now**, through its hooks and telemetry.
> Agent Brain is an independent project, not made by or affiliated with Anthropic.

![Agent Brain overview](docs/images/overview.png)

## Quick start

1. **Install the plugin.** With BRAT: add `mucahitkumlay/agent-brain`. Or download `main.js`, `manifest.json` and
   `styles.css` from the [latest release](../../releases/latest) into `<your vault>/.obsidian/plugins/agent-brain/`
   and enable it. Desktop only.
2. **Connect Claude Code.** Settings → Agent Brain → *Claude Code hooks on this computer* → **Install**, then restart
   running Claude Code sessions.
3. **Open the view** (ribbon icon or *Open Agent Brain view*). No session yet? The start screen lets you play made-up
   sessions and see everything work.

On first start the plugin downloads the brain anatomy once (about 3 MB) from this repository's
[anatomy release](../../releases/tag/anatomy-1) and checks it against SHA-256 sums built into the plugin.

## What it does

### See the work as it happens

- Each tool call travels along a real fibre bundle to the region for that kind of work: reading, editing, running
  commands, web, subagents. Thinking keeps circulating in the frontal lobe; a long command keeps its path busy.
- A line at the top says whether you need to act: an approval, a session that may be stuck, or nothing.
- When a turn ends, a card shows its duration, tool calls, files, last test run, cost and warnings.
- **Freeze time** (<kbd>Space</kbd>) and click any signal: who ran it, why, where it goes, every parameter and the
  output. The operation tree of the turn is one tab away.

![Signal inspector](docs/images/signal-inspector.png)

### Watchers

Four checks run all the time. They only watch: nothing is ever stopped.

| Watcher | It notices |
|---|---|
| **Guard** | destructive commands (`rm -rf`, `git push --force`, `DROP TABLE`, `curl \| sh` …) and secrets written in the open |
| **Shield** | outside content (a web page, a download) that tries to give the agent orders, and what the agent does next |
| **Reality** | the agent believing something that is not so: a file that does not exist, "it works" after a failed run |
| **Stuck** | the same command failing again and again, a command running for 20 minutes, no progress for 10 |

Findings are cards sorted by how much they ask of you (*Needs you now*, *Worth a check*, *For the record*). Each says
what happened and what to do, and can copy a short note to paste into the agent, open the project's lessons, mark the
finding as normal in that project, or be marked as done. *See it catch things* plays a short demo in which all four fire.

![The four watchers](docs/images/watchers.png)

### Your notes in the brain

Every note is a neuron, every link an axon that follows the folds of the cortex or a real white-matter bundle. Files
the agent uses one after the other grow a connection, and signals follow it.

The **notes view** (<kbd>D</kbd>) switches to the *Notes* look: the cortex becomes a cloud of points in its regions'
colours and your notes stand out, sized by their links. Search, browse by region, or pick a note: the brain turns to it
and a signal runs along each of its links. Notes are placed by their `type`, `kind` or `category`, their tags or their
folder, and you can add your own rules in the settings (`type:wiki=occipital`).

### Get better at working with it

The *Use Claude Code better* panel (<kbd>U</kbd>) compares this week with the last from your own turns and suggests
what to change, each with the numbers behind it: permission rules for commands you keep approving, CLAUDE.md lines,
when to start fresh. Only numbers are kept, never prompts or file contents. **Copy for a review** puts those numbers on
the clipboard to paste into any chat for a second opinion.

### And more

- **Lessons** per project (the test command that works, commands that are not installed), ready for CLAUDE.md.
- **Autopsy, replays and comparison:** a session's key moments, a shareable replay without names, paths or prompts,
  two sessions side by side, a project map.
- **Energy** from telemetry: tokens, context and cost per session, with optional spending limits.
- **Looks and layers:** *Anatomy*, *Atlas* (see-through) and *Notes*; inner structures, fibre tracts, MRI slices; themes
  including a colour-blind safe high-contrast one; *Reduce motion*.
- **Daily note** and an optional note per session; EEG traces; body signals of each machine.

## Keys

| Key | |
|---|---|
| <kbd>Space</kbd> | Freeze time and inspect signals (<kbd>,</kbd> <kbd>.</kbd> slower, faster) |
| <kbd>[</kbd> <kbd>]</kbd>, <kbd>Enter</kbd> | Previous / next signal, open it |
| <kbd>S</kbd> <kbd>A</kbd> <kbd>T</kbd> <kbd>G</kbd> <kbd>E</kbd> | Sessions, activity, timeline, regions, EEG |
| <kbd>W</kbd> <kbd>U</kbd> <kbd>D</kbd> <kbd>?</kbd> | Watchers, use it better, notes, what can I do here |
| <kbd>L</kbd> <kbd>M</kbd> <kbd>V</kbd> | Layers, MRI slice, look |
| <kbd>F</kbd> <kbd>R</kbd> <kbd>H</kbd> <kbd>I</kbd> | Follow activity, reset view, hide everything, info |

<details>
<summary><b>Sessions on a server</b></summary>

Claude Code on a remote machine reaches the plugin through a reverse SSH tunnel:

1. Start the tunnel on your computer: `scripts/tunnel/agent-brain-tunnel.sh user@server` (macOS/Linux), or set
   `SERVER` in `scripts/tunnel/agent-brain-tunnel.bat` and run it (Windows). Key-based SSH login must already work.
2. On the server, once, while the tunnel is up: `curl -s http://127.0.0.1:27182/install.sh | sh`. This installs the
   hooks, an offline queue (events wait while the tunnel is down), a heartbeat and the telemetry settings.
3. Restart the tunnel and the Claude Code sessions on the server.

</details>

<details>
<summary><b>Other agents</b></summary>

Any agent can report by posting JSON (one event or a list) to `http://127.0.0.1:27182/agent`:

```json
{ "agent": "my-agent", "session": "42", "cwd": "/path/to/project", "type": "tool", "tool": "Bash", "id": "c1", "input": { "command": "npm test" } }
```

`type` is `start`, `prompt` (`text`), `tool` (`tool`, `input`, `id`), `result` (`id`, `output`), `error` (`id`,
`output`), `wait`, `stop` (`text`) or `end`. They become the same events Claude Code's hooks send.

</details>

<details>
<summary><b>Coach mode</b> (off by default)</summary>

With *Coach mode* on (Settings → Alerts) and the hooks installed again, guard, shield and important reality findings
go back to the agent as a note on its next tool result, so it can check itself. Never a decision, never a block.

</details>

## Privacy and permissions

| | |
|---|---|
| **Network** | One request, once: the anatomy files from this repository's release, checked by SHA-256. No telemetry, analytics, model calls or other servers. |
| **Listener** | HTTP on `127.0.0.1` only, so Claude Code's hooks can report. It answers with an empty response (except Coach mode) and refuses requests that look like they come from a web page. |
| **Files outside the vault** | Only Claude Code's `settings.json`: read by the setup check, and backed up and written when you press *Install*. |
| **Vault** | Notes are listed by path; links, frontmatter and tags come from Obsidian's own cache. Note contents are not read, except the plugin's own notes and a replay you pick. It writes only what you ask for (daily note, session notes, lessons, replays). |
| **Stored on disk** | Settings and short labels (file and program names, never command lines), lessons, and for *Use it better* one line of numbers per turn. Never prompts, file contents or paths. |
| **In memory only** | Full call details for the inspector (capped, gone when Obsidian closes; can be turned off). |
| **Clipboard** | Written only when you press a *Copy* button; never read. |

Use it on sessions you run or have permission to observe. The inspector shows what the agent saw, so check before you
share a screenshot. Watchers are hints, not protection: keep Claude Code's own permissions and sandboxing on.

## Build from source

```sh
npm ci && npm run build && npm test
```

`dev/` runs the plugin in a browser outside Obsidian; `tools/anatomy/` rebuilds the anatomy data. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Credits and licences

The plugin code is [MIT](LICENSE), © 2026 mucahitkumlay. The licences below are the whole grant; nothing in this README
adds rights or gives a warranty.

| What | Where | Licence |
|---|---|---|
| Plugin code, scripts, tools, tests, docs | `src/`, `scripts/`, `tools/`, `test/`, `dev/`, `docs/`, `.github/`, `*.md` | [MIT](LICENSE) |
| three.js | bundled in `main.js` | MIT, © 2010–2026 three.js authors |
| Brain surface, T1 volume, ventricles | `assets/brain.bin.gz`, `t1.bin.gz`, part of `inner.bin.gz` | MNI ICBM152 2009 template, **copyright notice kept** (McConnell Brain Imaging Centre, MNI, McGill University) |
| Gyrus labels, deep nuclei | `assets/aal.bin.gz`, part of `inner.bin.gz` | Derived from the AAL atlas (GIN-IMN, Bordeaux), with attribution |
| White-matter fibres | `assets/tracts.bin.gz` | Derived from the HCP-1065 atlas (F.-C. Yeh), **CC BY-SA 4.0** |
| Source files for the data | — | the [niivue](https://github.com/niivue/niivue) project (BSD 2-Clause) |

Full texts, required notices, changes to the data and citations: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). If
you redistribute the plugin or its data, keep `LICENSE` and `THIRD_PARTY_NOTICES.md`, keep the ICBM notice, credit AAL
and HCP-1065, and keep changes to `tracts.bin.gz` under CC BY-SA 4.0.

**Trademarks.** Claude and Claude Code are trademarks of Anthropic, PBC; Obsidian is a trademark of Dynalist Inc. They
are named only to say what the plugin works with; Agent Brain is not affiliated with or endorsed by either.

**Not a medical or scientific tool.** The brain mapping is a visual metaphor grounded in real anatomy. It does not model
how a language model works and must not be used for diagnosis, treatment or research.

**No warranty.** Provided "as is", as stated in the licences.

Security problems: please report them privately through GitHub's **Report a vulnerability** (Security tab).
