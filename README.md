# CC Good Boy

A Tampermonkey userscript that plays Cookie Clicker's golden-cookie game.
See [AGENTS.md](AGENTS.md) for the full behavior spec and architecture.

## Build

No Node install required on your machine — everything runs in Docker via
the `Makefile`.

```bash
make build
```

Produces `dist/cc-good-boy.user.js`, the single file to install in
Tampermonkey. Point Tampermonkey at that file (or paste its contents into a
new script) to install/update the bot.

## Other targets

```bash
make dev        # esbuild watch mode, rebuilds dist/ on change
make test       # unit tests (vitest)
make test-e2e   # end-to-end tests (playwright, needs network access)
make typecheck  # tsc --noEmit
make shell      # interactive shell inside the build container
make lock       # regenerate package-lock.json on the host
```

Requires Docker (`docker info` must succeed). Each target builds the image
if needed, bind-mounts the repo into the container, and uses a named
volume for `node_modules` so it doesn't get shadowed by the bind mount.

## Layout

- `src/` — the TypeScript source, one module per concern (see AGENTS.md's
  architecture section for the module map).
- `legacy/cc-bot.original.js` — the original 11K-line monolith, frozen, kept
  as a behavior-reference baseline for the refactor.
- `tests/unit/` — Vitest unit tests.
- `tests/e2e/` — Playwright end-to-end tests, including savegame fixtures
  under `tests/e2e/fixtures/saves/`.
- `build/` — the esbuild bundling script and the userscript metadata banner.
