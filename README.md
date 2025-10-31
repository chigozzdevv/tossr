# TOSSR.gg

Provably Random Gaming Platform — monorepo containing the web client, backend API, and on-chain programs.

## Monorepo layout

```
.
├── client      # React 19 + Vite + Tailwind UI (Solana wallet adapters)
├── server      # Fastify + TypeScript + MongoDB (Mongoose) + Redis + Solana/MagicBlock
└── contracts   # On-chain code
    ├── anchor       # Solana Anchor workspace (tossr-engine program)
    └── tee-engine   # Rust crate for TEE integration utilities
```

## Prerequisites

- Node.js 20+ and npm
- MongoDB (local or remote)
- Redis (local or remote)
- Rust toolchain (for contracts) and Solana/Anchor CLIs if you work on programs:
  - rustup + cargo
  - solana-cli
  - anchor-cli 0.31.1

## Quick start (local)

1) Start dependencies (MongoDB, Redis).

2) Backend API

```
cd server
npm install

# Create .env with the required settings (see template below)
# Then start the dev server
npm run dev
```

The API will run on http://localhost:3001 (change via `PORT`). Open API docs at http://localhost:3001/docs.

3) Web client

```
cd client
npm install

# Optional: client .env (see below) — set VITE_API_URL to point to the server
npm run dev
```

The client runs on http://localhost:5173 by default.

## Environment variables

### Server (.env in `server/`)

Minimal template to boot locally; replace placeholders with your values.

```
# App
NODE_ENV=development
PORT=3001
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173

# Datastores
MONGODB_URI=mongodb://localhost:27017/tossr
REDIS_URL=redis://localhost:6379

# Solana / MagicBlock endpoints (Devnet defaults shown)
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com
EPHEMERAL_RPC_URL=https://devnet-router.magicblock.app
EPHEMERAL_WS_URL=wss://devnet.magicblock.app
TEE_RPC_URL=https://tee.magicblock.app

# Programs / queues
VRF_ORACLE_QUEUE=REPLACE_WITH_QUEUE_PUBKEY
DELEGATION_PROGRAM_ID=REPLACE_WITH_PROGRAM_ID
MAGIC_PROGRAM_ID=REPLACE_WITH_PROGRAM_ID
TEE_PROGRAM_ID=REPLACE_WITH_PROGRAM_ID
PERMISSION_PROGRAM_ID=REPLACE_WITH_PROGRAM_ID
TOSSR_ENGINE_PROGRAM_ID=5xmSvdzDsFY4bx5nyFiMpmq881Epcm7v3Dxsxw54gGcX

# Auth / security
JWT_SECRET=replace-with-long-random-string

# Admin keypair (Solana secret key JSON array as a single line)
# Example: ADMIN_PRIVATE_KEY="[12,34, ...]"
ADMIN_PRIVATE_KEY=[REPLACE_WITH_SECRET_KEY_JSON_ARRAY]

# Optional
TEE_INTEGRITY_REQUIRED=false
TEE_PRIVATE_KEY_HEX=
```

If any required variable is missing, the server will exit early with a validation error.

### Client (.env in `client/`)

```
VITE_API_URL=http://localhost:3001/api/v1
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_EPHEMERAL_RPC_URL=https://devnet-router.magicblock.app
VITE_EPHEMERAL_WS_URL=wss://devnet.magicblock.app
# Optional UI timing
VITE_ROUND_DURATION_SECONDS=60
```

## Common scripts

### Server

```
# Development
npm run dev

# Build / start (production)
npm run build && npm start

# Tests
npm test          # Vitest
npm run test:ui   # Vitest UI

# Utilities (selection)
npm run markets:list
npm run markets:create
npm run rounds:check
```

### Client

```
npm run dev       # Vite dev server
npm run build     # Production build
npm run preview   # Preview built app
npm run lint      # Lint sources
```

## Contracts

- Anchor workspace: `contracts/anchor` (program name: `tossr_engine`, Devnet ID set in Anchor.toml).
- Build/test with Anchor:

```
cd contracts/anchor
anchor build
anchor test
```

- TEE utilities crate: `contracts/tee-engine` (standard Rust crate):

```
cd contracts/tee-engine
cargo build
```

> Note: Deploying programs and configuring queues/IDs is environment-specific. Ensure the server `.env` program IDs and queue addresses match your deployment.

## Notes

- API docs: http://localhost:3001/docs (Fastify Swagger UI)
- Default ports: server 3001, client 5173
- Tech highlights: Fastify, TypeScript, Mongoose (MongoDB), Redis, Solana (web3.js), MagicBlock ER, Anchor
