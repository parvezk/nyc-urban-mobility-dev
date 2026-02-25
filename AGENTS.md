# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is a client-side React/deck.gl geospatial visualization app ("Urban Mobility Development Project") displaying NYC taxi trip data, 3D buildings, and congestion corridors on an interactive Mapbox map. There is no backend service, database, or Docker required.

### Node.js version

This project requires **Node.js 8** (v8.17.0). The dependencies `node-sass@4.8.3` and `webpack@^2.2.0` are incompatible with newer Node versions. Use `nvm use 8` to switch.

### Environment variables

The webpack build requires three Mapbox token environment variables to be set (via `webpack.EnvironmentPlugin`). They are already configured in `~/.bashrc`:

- `MAPBOX_ACCESS_TOKEN`
- `MAPBOX_TOKEN`
- `MapboxAccessToken`

The token value is hardcoded in `app.js` as well, so the env vars just need to be defined (any non-empty value works for the build).

### Dependency quirks

- `d3-ease` is used in `app.js` but not listed in `package.json`. Install it separately: `npm install --no-save d3-ease`.
- `mjolnir.js@2.7.x` (pulled by deck.gl) uses object spread syntax incompatible with webpack 2. Pin it: `npm install --no-save mjolnir.js@2.3.0`.
- `node-sass@4.8.3` downloads a prebuilt binary for Node 8 (ABI 57). Other Node versions will fail.

### Running the dev server

```bash
nvm use 8
npm run start   # or: npx webpack-dev-server --progress --hot --host 0.0.0.0 --port 8080
```

The `start` script includes `--open` which tries to open a browser; use the `npx` form above to avoid that in headless environments.

### Lint / Test / Build

This project has no configured linter, test runner, or separate build script. The only scripts in `package.json` are `start` and `start-local`. Webpack compilation during `npm run start` serves as the build check.

### Known warnings

Two non-blocking warnings appear during build:
- `"export 'loadTextures' was not found in 'luma.gl'`
- `"export 'loadImages' was not found in 'luma.gl'`

These are safe to ignore; they relate to optional icon-layer features not used by this project.
