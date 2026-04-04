# Checkmate AI Coding Agent Instructions

Checkmate is an open-source uptime and infrastructure monitoring application with real-time alerts. This guide helps AI agents contribute effectively.

## Architecture Overview

**Monorepo Structure:**
- `/client` — React 18 + TypeScript + Vite (port 5173)
- `/server` — Node.js 20+ + Express + TypeScript (port 52345)
- `/docker` — Multi-environment configs (dev, staging, prod, arm, mono)

**Key Tech Stack:**
- Database: MongoDB + Mongoose ODM
- Queue/Cron: BullMQ + Redis + Pulse
- State: Redux Toolkit + Redux-Persist
- API Fetching: Axios + SWR
- Validation: Zod (server), Joi (client)
- i18n: i18next via PoEditor

## Backend Architecture (`server/src/`)

**Layered Pattern:**
```
controllers/     → Request handlers (validate input, delegate to service)
service/         → Business logic (business/, infrastructure/, system/)
repositories/    → Data access layer (abstraction over Mongoose)
db/models/       → Mongoose schemas (Monitor, Check, User, Team, etc.)
middleware/v1/   → Auth (verifyJWT), rate limiting, sanitization
validation/      → Zod schemas for request validation
```

**Key Services:**
- `MonitorService` — CRUD and monitoring logic
- `CheckService` — Check result processing
- `UserService` — Auth and user management
- `StatusPageService` — Public status page management
- `IncidentService` — Downtime tracking

**Error Handling Pattern:**
Use `AppError` class (not plain `Error`):
```typescript
throw new AppError({
  message: "User not found",
  status: 404,
  service: "userService",
  method: "getUserById",
  details: { userId: "xyz" }
});
```

**Request Flow Example:**
1. Controller validates using Zod schema → `parseAsync()`
2. Extract `teamId`/`userId` via `requireTeamId()` helper
3. Call service method with validated data
4. Service queries repository → business logic → response
5. Error middleware catches and logs via `AppError`

## Frontend Architecture (`client/src/`)

**Folder Pattern:**
```
Components/   → Reusable UI components
Pages/        → Page-level components (Auth, Monitors, Infrastructure)
Features/     → Redux slices (Auth, UI)
Hooks/        → Custom React hooks (UseApi, UseToast, form-specific)
Validation/   → Joi schemas
Utils/        → ApiClient.ts (main HTTP client), utilities
locales/      → i18n translation files
```

**State Management:**
- Redux Toolkit for global state (auth, ui)
- Redux-Persist saves auth to localStorage (but filters `profileImage`)
- Local component state for UI interactions

**Data Fetching Pattern:**
Use ApiClient (wraps Axios):
```typescript
import * as ApiClient from "@/Utils/ApiClient";
// ApiClient.get<T>(), .post<T>(), .patch<T>(), .delete<T>()
```
- Interceptors auto-inject Bearer token from Redux `auth.authToken`
- Error handler redirects to `/login` on 401
- Network errors trigger server-unreachable callback

**i18n Convention:**
All user-facing strings must use translation keys:
```typescript
const { t } = useTranslation();
return <div>{t('monitor.created')}</div>;
// Never hardcode UI strings
```

## Critical Developer Workflows

### Server Development
```bash
cd server
npm install
npm run dev              # Hot-reload via nodemon + tsx
npm run build            # TypeScript + tsc-alias
npm run test             # Jest with c8 coverage
npm run lint             # ESLint v9
npm run lint-fix         # Auto-fix
npm test -- --grep "pattern"  # Run specific tests
```

### Client Development
```bash
cd client
npm install
npm run dev              # Vite dev server (http://localhost:5173)
npm run build            # tsc check + production build
npm run lint             # ESLint (strict, max-warnings 0)
npm run format-check     # Prettier validation
npm run format           # Auto-format
```

### Docker Development
```bash
cd docker/dev
./build_images.sh
# MongoDB already configured in docker-compose.yaml
```

## Project-Specific Conventions

### Branching & PRs
- **Always branch from `develop`** (not master/main)
- Use descriptive names: `feat/add-alerts`, `fix/login-error`
- PRs target `develop` branch

### Formatting
- **Prettier config:** `printWidth: 150` (server), `printWidth: 90` (client), tabs, double quotes
- **ESLint:** Strict settings, zero warnings policy
- **Validation:** Server uses Zod (z.object, z.string, etc.), client uses Joi

### API Routes
- Base: `/api/v1`
- Most routes require `verifyJWT` middleware
- OpenAPI docs: `http://localhost:52345/api-docs`
- OpenAPI spec: `/server/openapi.json` (reference for new endpoints)

### Database Models
Key Mongoose schemas in `/server/src/db/models/`:
- **Monitor** — Monitoring config (website, infrastructure, port, SSL)
- **Check** — Individual check result (response time, status)
- **Incident** — Downtime period (start, end, affected monitor)
- **User, Team** — Users and team/workspace management
- **Notification** — Alert config (email, Discord, Slack, webhooks)
- **MaintenanceWindow** — Scheduled downtime periods
- **StatusPage** — Public status pages
- **AppSettings** — Global settings (JWT secret, etc.)

### Testing Pattern (Server)
Use Jest + Sinon for mocks:
```typescript
const mockRepository = {
  findById: jest.fn(),
  create: jest.fn(),
};
const service = new MonitorService({ repository: mockRepository });
await service.getMonitor(id);
expect(mockRepository.findById).toHaveBeenCalledWith(id);
```
Test files: `server/test/**/*.test.ts`

## Environment Setup

**Server `.env` (minimum):**
```env
CLIENT_HOST="http://localhost:5173"
JWT_SECRET="my_secret_key_change_this"
DB_CONNECTION_STRING="mongodb://localhost:27017/uptime_db"
TOKEN_TTL="99d"
ORIGIN="localhost"
LOG_LEVEL="debug"
```

**Client `.env`:**
```env
VITE_APP_API_BASE_URL="http://localhost:52345/api/v1"
VITE_APP_LOG_LEVEL="debug"
```

## Integration Points

**Redis/BullMQ:** Job queues for async tasks (check processing, notifications)
**Mongoose Migrations:** Run on startup in `db/migration/` (non-blocking)
**gRPC Integration:** Used for Capture agent communication
**Webhooks:** StatusPage can send incident notifications via webhooks

## Common Tasks

### Adding a New Monitor Type
1. Extend `Monitor` schema in `/server/src/db/models/Monitor.ts`
2. Add validation schema in `/server/src/validation/monitorValidation.ts`
3. Add check logic in `CheckService`
4. Add repository query methods as needed
5. Create/update controller action
6. Add route in `/server/src/routes/monitorRoute.ts`

### Adding a New API Endpoint
1. Add Zod validation schema in `/server/src/validation/`
2. Implement controller method in `/server/src/controllers/`
3. Add repository/service methods as needed
4. Create route in `/server/src/routes/` (class-based)
5. Register in `/server/src/config/routes.ts`
6. Update OpenAPI spec if documenting

### Frontend Page/Feature
1. Create component in `/Components/` or `/Pages/`
2. Use Redux hooks for global state (auth, ui)
3. Use custom hooks for forms (UseApi, useLoginForm, etc.)
4. Add i18n keys in `locales/`
5. Add Joi validation in `/Validation/`
6. Create Redux slice in `/Features/` if needed

## Important Patterns to Follow

- **Error handling:** Always use `AppError` on server, log with context
- **Async:** Controllers use try-catch with `next(error)` pattern
- **Validation:** Validate early in controller, fail fast
- **Types:** Define interfaces (e.g., `IMonitorService`) for dependency injection
- **Repositories:** Abstract data access; avoid direct model calls in services
- **i18n:** Never hardcode user-facing strings
- **Testing:** Mock external dependencies; test service logic separately

## Performance Notes

- Checkmate stress-tested with 1000+ active monitors
- Use Redis for caching and queuing
- BullMQ handles background job distribution
- Mongoose lean() queries when projection sufficient
- Frontend lazy-loads route components with React.lazy()

## References

- OpenAPI spec: `/server/openapi.json`
- CLAUDE.md: Extended development guide
- CONTRIBUTING.md: Community guidelines
- GitHub Issues: Use good-first-issue labels for onboarding
