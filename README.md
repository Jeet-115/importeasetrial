# tallyhelpersoftwareversion

## Backend (Offline JSON Store)
- Data is stored locally under `storage/data` as JSON files (no MongoDB required).
- Run the API with `cd backend && npm run dev` to start the Express server on port `5000`.
- The server initializes default data files (`invoices.json`, `settings.json`, and collection caches) automatically on first run.

## Development Scripts
- `npm run dev:backend` — start the JSON-backed Express API.
- `npm run dev:client` — start the Vite React client (talks to `http://localhost:5000`).
- `npm run dev:electron` — launch the Electron shell pointing to the local client/backend.
- `npm run dev` — run all three together via `concurrently`.

## Building / Packaging
- `npm run dist` runs the Vite production build and then delegates to `npm run build:electron`.
- `npm run build:electron` executes `electron-builder` from the `electron` workspace. Update `electron-builder` config (e.g., `electron-builder.yml` or `package.json` fields) to produce installers for your target platforms before running the command. You can install platform-specific dependencies if required by Electron Builder.