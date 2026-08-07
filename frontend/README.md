# BlitzMine frontend

The BlitzMine client is a Next.js application for funding a Miner account, delegating it to a MagicBlock Ephemeral Rollup, deploying SOL across the shared board, following live round state, and settling winnings back to Solana.

## Setup

Copy `.env.example` to `.env.local` and provide the public runtime values for the backend, Solana cluster, program, and Privy application.

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). The backend and WebSocket gateway must be running on the URLs configured in `.env.local`.

## Checks

```bash
bunx tsc --noEmit
bun run test
bun run build
```

For the complete validator, Ephemeral Rollup, VRF, database, backend, and browser stack, run `bun run dev:local` from the repository root.
