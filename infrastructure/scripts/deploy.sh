#!/usr/bin/env bash
set -euo pipefail

echo "Deploying BlitzMine..."

CLUSTER=${1:-devnet}

echo "Building Anchor program..."
cd program && anchor build && cd ..

echo "Deploying to $CLUSTER..."
cd program && anchor deploy --provider.cluster "$CLUSTER" && cd ..

echo "Running database migrations..."
cd backend && bunx prisma migrate deploy && cd ..

echo "Deployment complete!"
