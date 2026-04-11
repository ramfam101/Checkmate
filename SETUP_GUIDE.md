# Checkmate Local Development Setup Guide

This is a comprehensive guide to set up and run Checkmate locally for development purposes.

## Prerequisites

Make sure you have the following installed:

- **Node.js** (v16+) — [Download](https://nodejs.org/)
- **npm** — Comes with Node.js
- **Docker** — [Download](https://www.docker.com/products/docker-desktop)
- **Git** — [Download](https://git-scm.com/)

Check your installations:

```bash
node --version      # Should be v16 or higher
npm --version
docker --version
git --version
```

## Quick Setup Overview

This guide will walk you through 5 main steps:

1. ✅ Clone the Repository (already done if you're reading this)
2. 🐳 Set Up MongoDB Docker Container
3. 🔙 Set Up Backend (Node.js/Express Server)
4. 🎨 Set Up Frontend (React/Vite Client)
5. 🚀 Start the Application

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/bluewave-labs/Checkmate.git
cd Checkmate
```

**Note:** If you're already in the project directory, this step is complete.

---

## Step 2: Set Up MongoDB Docker Container

MongoDB is the database that Checkmate uses. We'll run it in a Docker container.

### 2.1: Build Docker Images

Navigate to the Docker dev directory:

```bash
cd docker/dev
./build_images.sh
```

Navigate back to the root:

```bash
cd ../..
```

### 2.2: Run MongoDB Container

```bash
docker run -d -p 27017:27017 -v uptime_mongo_data:/data/db --name uptime_database_mongo mongo:6.0
```

**Verify MongoDB is running:**

```bash
docker ps | grep uptime_database_mongo
```

You should see the MongoDB container listed. If you need to stop it later:

```bash
docker stop uptime_database_mongo
docker start uptime_database_mongo
```

---

## Step 3: Set Up Backend (Server)

The backend is a Node.js/Express application running on port `52345`.

### 3.1: Navigate to Server Directory

```bash
cd server
```

### 3.2: Install Dependencies

```bash
npm install
```

### 3.3: Create `.env` File

Create a `.env` file in the `server` directory with the following content:

```env
CLIENT_HOST="http://localhost:5173"
JWT_SECRET="my_secret_key_change_this"
DB_CONNECTION_STRING="mongodb://localhost:27017/uptime_db"
TOKEN_TTL="99d"
ORIGIN="localhost"
LOG_LEVEL="debug"
```

**Environment Variables Explained:**

| Variable | Description |
|----------|-------------|
| `CLIENT_HOST` | Frontend URL (default: http://localhost:5173) |
| `JWT_SECRET` | Secret key for JWT tokens (⚠️ change in production) |
| `DB_CONNECTION_STRING` | MongoDB connection URL |
| `ORIGIN` | Origin for CORS purposes |
| `TOKEN_TTL` | Token time to live (in vercel/ms format) |
| `LOG_LEVEL` | Debug level: debug, info, warn, error |

### 3.4: Start Backend Server

```bash
npm run dev
```

The backend server will start at **http://localhost:52345**.

You'll see output like:
```
✓ Server is running at http://localhost:52345
```

**Alternative commands for backend:**

```bash
npm run build            # TypeScript compile + path alias resolution
npm run test             # Run tests with coverage
npm run lint             # ESLint check
npm run lint-fix         # Auto-fix lint issues
npm run format           # Prettier formatting
```

---

## Step 4: Set Up Frontend (Client)

The frontend is a React/Vite application running on port `5173`.

### 4.1: Open New Terminal & Navigate to Client Directory

Keep the backend running and open a **new terminal window**:

```bash
cd client
```

### 4.2: Install Dependencies

```bash
npm install
```

### 4.3: Create `.env` File

Create a `.env` file in the `client` directory:

```env
VITE_APP_API_BASE_URL="http://localhost:52345/api/v1"
VITE_APP_LOG_LEVEL="debug"
```

**Environment Variables Explained:**

| Variable | Description |
|----------|-------------|
| `VITE_APP_API_BASE_URL` | Backend API URL |
| `VITE_APP_LOG_LEVEL` | Log level: none, error, warn, debug, info |

### 4.4: Start Frontend Server

```bash
npm run dev
```

The frontend will start at **http://localhost:5173**.

You'll see output like:
```
✓ ready in 1234 ms
Local: http://localhost:5173/
```

**Alternative commands for frontend:**

```bash
npm run build            # TypeScript check + production build
npm run lint             # ESLint check
npm run format           # Prettier formatting
npm run format-check     # Check formatting
```

---

## Step 5: Access the Application

You now have everything running! Access the application at:

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:52345](http://localhost:52345)
- **API Documentation**: [http://localhost:52345/api-docs](http://localhost:52345/api-docs) (Swagger UI)

---

## Verification Checklist

After setup, verify everything is working:

- [ ] MongoDB container is running: `docker ps | grep uptime_database_mongo`
- [ ] Backend server is running at http://localhost:52345
- [ ] Frontend is running at http://localhost:5173
- [ ] Frontend loads without errors
- [ ] API documentation is accessible at http://localhost:52345/api-docs

---

## Troubleshooting

### Port Already in Use

If you get "port already in use" error:

```bash
# Find process using the port (example for port 5173)
lsof -i :5173

# Kill the process
kill -9 <PID>

# Or change the port in .env file
```

**Common ports used:**

- Frontend: `5173`
- Backend: `52345`
- MongoDB: `27017`
- Redis: `6379`

### MongoDB Connection Issues

Check if MongoDB container is running:

```bash
docker ps | grep mongo

# If not running, start it
docker start uptime_database_mongo

# Check logs
docker logs uptime_database_mongo
```

### Module Not Found Errors

Make sure you ran `npm install` in both directories:

```bash
cd server && npm install && cd ../client && npm install
```

### Hot Reload Not Working

Restart the dev server:

```bash
# Stop with Ctrl+C
# Then run again
npm run dev
```

---

## Development Workflow

### Running Tests (Backend)

```bash
cd server
npm test                           # Run all tests
npm test -- --grep "pattern"       # Run specific tests
```

### Linting & Formatting

```bash
# Client
cd client
npm run lint
npm run format

# Server
cd server
npm run lint-fix
npm run format
```

### Stopping Services

To stop everything:

```bash
# In backend terminal: Press Ctrl+C
# In frontend terminal: Press Ctrl+C

# Stop MongoDB
docker stop uptime_database_mongo
```

---

## Next Steps

1. **Explore the codebase** — Check out the architecture in `CLAUDE.md`
2. **Read API docs** — Visit http://localhost:52345/api-docs
3. **Pick an issue** — Look for [`good-first-issue`](https://github.com/bluewave-labs/checkmate/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) labels
4. **Join Discord** — [Checkmate Discord](https://discord.com/invite/NAb6H3UTjK)

---

## Additional Resources

- **Full Documentation**: [https://docs.checkmate.so](https://docs.checkmate.so)
- **Architecture Guide**: [CLAUDE.md](./CLAUDE.md)
- **Contributing Guidelines**: [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Code of Conduct**: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

## Need Help?

- 💬 Ask on [Discord](https://discord.com/invite/NAb6H3UTjK)
- 📝 Check [GitHub Discussions](https://github.com/bluewave-labs/Checkmate/discussions)
- 🐛 Report bugs on [GitHub Issues](https://github.com/bluewave-labs/Checkmate/issues)

Happy contributing! 🚀
