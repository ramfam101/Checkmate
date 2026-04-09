# Copilot instructions for Checkmate

## Big picture
- Checkmate is a monorepo with a React/Vite client (`client/`) and a Node/Express API server (`server/`).
- Runtime bootstrap is centralized in `server/src/index.ts`: validate env -> load settings -> create logger -> initialize services -> run DB migrations -> initialize controllers -> mount routes.
- Services are wired manually in `server/src/config/services.ts` (dependency-injection by constructor, no IoC container). Keep new dependencies explicit here.
- Request flow is route class -> controller -> service -> repository (`server/src/routes`, `server/src/controllers`, `server/src/service`, `server/src/repositories`).

## Monitoring data flow (critical)
- Scheduler logic lives in `server/src/service/infrastructure/SuperSimpleQueue/*`.
- `SuperSimpleQueue` creates recurring jobs per monitor (and optional `-geo` jobs).
- `SuperSimpleQueueHelper.getHeartbeatJob()` is the core monitor loop: maintenance check -> network provider check -> build check -> buffer write -> status update -> notifications/incidents.
- New monitor behavior usually needs coordinated changes in:
  - monitor type definitions: `server/src/types/monitor.ts`
  - validation schemas: `server/src/validation/monitorValidation.ts`
  - network provider registration: `server/src/config/services.ts`
  - client monitor form defaults: `client/src/Hooks/useMonitorForm.ts`

## API and client contract
- API namespace is `/api/v1/*` from `server/src/config/routes.ts`; Swagger is served at `/api-docs`.
- Controllers typically return `{ success, msg, data }` on success; keep this shape for client compatibility (`client/src/Hooks/UseApi.ts`).
- Auth token is read from `Authorization: Bearer <token>` in `verifyJWT`; frontend injects this in `client/src/Utils/ApiClient.ts`.
- Role gates use `isAllowed(["admin", "superadmin"])` style checks in route classes.

## Project-specific conventions
- Use path alias `@/` in both client and server imports (see `client/tsconfig.app.json`, `server/tsconfig.json`).
- Validation uses `zod` with `schema.parse(...)` inside controllers; avoid ad-hoc request parsing.
- User-facing UI strings should go through i18n (`client/src/Utils/i18n.ts` + `client/src/locales/*.json`), not hardcoded English.
- Prettier is tab-based in both apps; line width differs (client 90, server 150).

## Workflows that matter
- Client: `npm run dev`, `npm run build`, `npm run lint` (run inside `client/`).
- Server: `npm run dev`, `npm run build`, `npm run test`, `npm run lint` (run inside `server/`).
- Server tests use Jest + ts-jest with ESM (`server/jest.config.ts`), test files are `server/test/**/*.test.ts`.
- Docker local stack is in `docker/dev/docker-compose.yaml` and expects images built by `docker/dev/build_images.sh`.

## Integration points / external systems
- MongoDB is the primary datastore; startup runs migrations in `server/src/db/migration/index.ts`.
- Monitoring providers include HTTP, ping, page speed, hardware (Capture agent), Docker, port, game, gRPC, and WebSocket (`server/src/config/services.ts`).
- Notification providers include webhook, email, Slack, Discord, PagerDuty, Matrix, Teams.

## Editing guidance for agents
- Prefer adding features through existing layers instead of bypassing with direct model access in controllers.
- When changing API payloads, update client hooks/forms/types in the same PR to keep contracts aligned.
- When adding routes, register them in `server/src/config/routes.ts`; when adding services/controllers, wire them in `server/src/config/services.ts` and `server/src/config/controllers.ts`.
