#!/bin/bash
# AgentHub VPS Deploy Script
set -e

echo "AgentHub Deploy Script"
echo "========================="

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "Node.js not found. Installing..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

NODE_VERSION=$(node -v)
echo "Node.js $NODE_VERSION"

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
  echo "Installing PM2..."
  sudo npm install -g pm2
fi

# Install dependencies
echo "Installing backend dependencies..."
npm install

echo "Installing frontend dependencies..."
cd client && npm install && cd ..

# Build frontend
echo "Building React frontend..."
npm run build:client

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Run migrations
echo "Running database migrations..."
npm run migrate

# Setup .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from template. Please edit it: nano .env"
fi

# Start/restart with PM2
echo "Starting with PM2..."
pm2 delete agenthub 2>/dev/null || true
pm2 start dist/index.js --name agenthub --restart-delay=3000
pm2 save
pm2 startup | tail -1 | bash 2>/dev/null || true

echo ""
echo "AgentHub deployed successfully!"
echo "Running at http://localhost:3000"
echo ""
echo "Useful PM2 commands:"
echo "  pm2 logs agenthub    - View logs"
echo "  pm2 status           - Check status"
echo "  pm2 restart agenthub - Restart"
