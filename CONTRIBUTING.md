# Contributing

Issues and pull requests are welcome.

## Layout

| Path | |
|---|---|
| `src/main.js` | the plugin: listener, session state, history, engram, telemetry, view (three.js) and HUD |
| `src/anatomy.js` | atlas tables (AAL names, gyri per kind of work) and the meshes, tracts and MRI slice materials |
| `src/intent.js` | what a shell, PowerShell or MCP call does (read, write, run, ops, web) |
| `src/styles.css` | the HUD |
| `scripts/` | server side: hook with offline queue, flush, link (heartbeat and body signals), installer template, tunnel launchers |
| `assets/` | anatomy data (see `tools/anatomy/README.md` and `THIRD_PARTY_NOTICES.md`) |
| `test/` | node tests run against `dist/main.js`, including the security invariants |
| `dev/` | browser harness with a mocked Obsidian |
| `tools/build.mjs` | production build with the licence banner |

## Workflow

```sh
bun install
bun run build && bun run test
node dev/prepare.mjs && (cd dev/www && python3 -m http.server 8799)   # then open the page and run __cbStart()
```

Keep the invariants: local only, watch never steer, one outgoing request, received content
is data, nothing private on disk. `test/invariants.test.js` and `test/listener.test.js` check them. Also: nothing that
runs on a timer when the view is closed unless it is cheap.

By contributing you agree that your contribution is licensed under the MIT licence of this repository (data files
under the terms listed in `THIRD_PARTY_NOTICES.md`), and that you have the right to submit it.

## Releases

1. Bump the version in `manifest.json`, `package.json` and `versions.json`.
2. Tag the commit with the bare version (`0.9.0`, no `v`) and push the tag. The release workflow builds the plugin and
   attaches `main.js`, `manifest.json`, `styles.css` and the anatomy files to a new release.
3. Check the release page.
