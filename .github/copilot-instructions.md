# Project Guidelines

## Code Style
- Use TypeScript conventions used in this repo and preserve existing folder structure and naming patterns.
- Formatting is mandatory before completing changes:
  - Client: tabs, double quotes, printWidth 90.
  - Server: tabs, double quotes, printWidth 150.
- Keep imports using the existing `@/` path alias when applicable.
- In the frontend, all user-facing text must be internationalized with `t("...")` (no hardcoded UI copy).
- Keep pull requests focused and small; avoid bundling unrelated fixes in the same change.

## Architecture
- Monorepo layout:
  - `client/`: React + Vite + Redux Toolkit + SWR frontend.
  - `server/`: Express + TypeScript + Mongoose backend.
  - `docker/`: environment-specific Docker setups (dev/staging/prod/arm/mono).
  - `charts/helm/checkmate/`: Helm chart deployment assets.
- Backend boundaries:
  - `controllers/` for HTTP handling.
  - `service/` for business/system/infrastructure logic.
  - `repositories/` + `db/models/` for data access and schemas.
  - `routes/v1/`, `middleware/`, `validation/` for API composition.
- Frontend boundaries:
  - `Pages/` for route-level views.
  - `Components/` for reusable UI.
  - `Features/` for Redux slices.
  - `Utils/NetworkService.js` as the core API client pattern.

## Build and Test
- Root:
  - `npm run prepare`
- Client (`cd client`):
  - `npm install`
  - `npm run dev`
  - `npm run build`
  - `npm run lint`
  - `npm run format` / `npm run format-check`
- Server (`cd server`):
  - `npm install`
  - `npm run dev`
  - `npm run build`
  - `npm run test`
  - `npm run lint` / `npm run lint-fix`
  - `npm run format` / `npm run format-check`

## Conventions
- Branch from `develop`, and target `develop` in PRs.
- Keep API routes under `/api/v1`; preserve existing response/error handling patterns.
- Local defaults commonly used by contributors:
  - Client on `http://localhost:5173`
  - Server on `http://localhost:52345`
  - MongoDB on `27017`
- If local setup or env details are needed, use existing docs instead of duplicating guidance:
  - `../CLAUDE.md`
  - `../CONTRIBUTING.md`
  - `../PULLREQUESTS.md`
  - `../docs/README.md`
