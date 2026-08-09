#!/usr/bin/env bash
set -euo pipefail

echo "Setting up BlitzMine development environment..."

echo "Installing backend dependencies..."
cd backend && bun install && cd ..

echo "Generating Prisma client..."
cd backend && bunx prisma generate && cd ..

echo "Setup complete!"
