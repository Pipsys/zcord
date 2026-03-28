# Rucord

Rucord is a full-stack desktop messenger inspired by modern community chat platforms, with secure auth, WebSocket realtime events, encrypted DM support primitives, media uploads, and an Electron + React desktop client.

## Monorepo Layout

- `backend/` FastAPI + PostgreSQL + Redis + MinIO + Alembic
- `client/` Electron + React + TypeScript + Tailwind + Framer Motion
- `docker-compose.yml` local dev stack (Postgres, Redis, MinIO, backend, Nginx)
- `docker-compose.prod.yml` production-oriented stack

## Quick Start (Docker)

1. Generate TLS certs into `certs/` (`fullchain.pem`, `privkey.pem`).
2. Generate JWT RSA keys into `secrets/` (`jwt_private.pem`, `jwt_public.pem`).
3. Copy and edit environment variables:
   - backend: `backend/.env.example -> backend/.env`
   - compose vars through shell or `.env`
4. Start stack:

```bash
docker compose up --build
```

5. Run migrations:

```bash
docker compose exec backend alembic upgrade head
```

Backend health: `https://localhost/health`

## Backend Dev (without Docker)

```bash
cd backend
pip install -e .
alembic upgrade head
uvicorn app.main:app --reload
```

## Client Dev

```bash
cd client
npm install
npm run electron:dev
```

## Tests

```bash
cd backend
pytest -q
```

Set `TEST_DATABASE_URL` to a PostgreSQL database before running tests.

## Security Highlights

- Argon2id password hashing (`time_cost=3`, `memory_cost=65536`)
- RS256 access + refresh tokens with refresh rotation in DB
- Token revocation checks for HTTP + WebSocket
- Security headers + HTTPS enforcement in production
- Rate limiting via `slowapi` and websocket event throttling
- MIME-validated file uploads with 50MB cap + MinIO pre-signed downloads
- Electron hardened runtime (`contextIsolation`, `nodeIntegration: false`, CSP, certificate pinning)
