# TOSSR.gg Server

Provably Random Gaming Platform Backend built with Node.js, TypeScript, and MagicBlock.

## 🏗️ Architecture

```
├── src/
│   ├── config/           # Database, Redis, Solana configuration
│   ├── features/         # Feature modules (auth, markets, bets, etc.)
│   ├── shared/           # Types, schemas, errors
│   ├── utils/            # Utilities (logging, auth, response)
│   ├── Blockchain/       # MagicBlock integration layer
│   └── scripts/          # Database seeding
```

## 🚀 Features

### Core Features
- **Authentication**: Solana wallet-based sign-in
- **Markets**: 10 different betting markets
- **Rounds**: Real-time round management
- **Bets**: Instant bet placement via MagicBlock ER
- **Attestations**: TEE-based proof verification

### Advanced Features
- **Entropy Battle**: Provable entropy comparison
- **Streak Meter**: Multi-round win tracking
- **Community Seeds**: Multi-party randomness
- **Jackpot**: Scheduled high-stakes rounds

## 🛠️ Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Fastify
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis
- **Blockchain**: Solana + MagicBlock SDK
- **Security**: JWT, Zod validation, Rate limiting
- **Testing**: Vitest

## 📦 Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# Seed database with initial data
npm run db:seed
```

## 🏃 Development

```bash
# Start development server
npm run dev

# Run tests
npm test

# Run tests with UI
npm test:ui

# Database operations
npm run db:studio     # Open Prisma Studio
npm run db:migrate    # Run migrations
npm run db:generate   # Generate client
npm run db:seed       # Seed database
```

# 🌐 API Documentation

Start the server and visit http://localhost:3001/docs for interactive API documentation.

## 🔗 Environment Variables

Required environment variables:

```bash
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/tosr"

# Redis
REDIS_URL="redis://localhost:6379"

# Solana & MagicBlock
SOLANA_RPC_URL="https://api.devnet.solana.com"
EPHEMERAL_RPC_URL="https://devnet-as.magicblock.app/"
TEE_RPC_URL="https://tee.magicblock.app/"

# Programs (replace with actual addresses)
DELEGATION_PROGRAM_ID="..."
MAGIC_PROGRAM_ID="..."
TEE_PROGRAM_ID="..."

# Security
JWT_SECRET="your-super-secret-jwt-key"
```

## 🔒 Security Features

- JWT-based authentication
- Rate limiting per IP
- Input validation with Zod
- Security headers with Helmet
- CORS configuration

## 📏 Project Structure

### Feature Modules

Each feature follows the pattern:
```
features/{feature}/
├── controllers/    # API handlers
├── services/       # Business logic
├── routes/         # Fastify route definitions
└── module.ts       # Feature exports
```

### Database Schema

See `prisma/schema.prisma` for complete database schema.

### Blockchain Integration

- MagicBlock SDK for ER operations
- TEE integration for provable randomness
- Solana Web3.js for blockchain interactions

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Generate coverage report
npm test -- --coverage
```

## 🚀 Deployment

```bash
# Build for production
npm run build

# Start production server
npm start
```

## 📊 Architecture Flow

```
Client → MagicBlock ER → TEE Enclave → Solana Verification → Database
```

1. **Client** places bet via MagicBlock ER (instant)
2. **TEE Enclave** generates provable randomness
3. **Solana** verifies attestation on-chain
4. **Database** stores results and history

## 🎯 Market Types

1. **Pick the Range**: Choose prediction range width
2. **Even / Odd**: Classic 50/50 binary bets
3. **Last Digit**: 0-9 digit guessing
4. **Modulo-3**: Remainder betting
5. **Pattern of the Day**: Rotating mathematical patterns
6. **Shape & Color**: Visual attribute betting
7. **Jackpot**: Exact number high-stakes
8. **Entropy Battle**: Source randomness comparison
9. **Streak Meter**: Consecutive win tracking
10. **Community Seed**: Multi-party randomness aggregation

## 🔮 Future Enhancements

- Real-time WebSocket connections
- Advanced analytics dashboard
- Automated round scheduler
- Enhanced TEE integration
- Cross-chain support
