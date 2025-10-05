#!/bin/bash

# Quick Migration Setup Script
echo "🚀 Setting up database migrations..."

# Step 1: Download Cloud SQL Proxy
echo "📥 Downloading Cloud SQL Proxy..."
if [ ! -f "./cloud-sql-proxy" ]; then
    curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.11.0/cloud-sql-proxy.darwin.amd64
    chmod +x cloud-sql-proxy
    echo "✅ Cloud SQL Proxy downloaded"
else
    echo "✅ Cloud SQL Proxy already exists"
fi

# Step 2: Create temporary .env for migrations
echo "📝 Creating migration environment file..."

# Get secrets from Google Secret Manager
echo "🔐 Retrieving secrets from Google Secret Manager..."
DATABASE_PASSWORD=$(gcloud secrets versions access latest --secret="database-password" 2>/dev/null || echo "YOUR_DB_PASSWORD_HERE")
REDIS_PASSWORD=$(gcloud secrets versions access latest --secret="redis-password" 2>/dev/null || echo "redis_password")
JWT_SECRET=$(gcloud secrets versions access latest --secret="jwt-secret" 2>/dev/null || echo "YOUR_JWT_SECRET_HERE")

cat > .env.migration << EOF
NODE_ENV=production
DATABASE_HOST=localhost
DATABASE_PORT=5433
DATABASE_NAME=ats_fit
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=$DATABASE_PASSWORD
REDIS_HOST=10.70.241.139
REDIS_PORT=6379
REDIS_PASSWORD=$REDIS_PASSWORD
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=24h
EOF

echo "✅ Migration environment created"

# Step 3: Start Cloud SQL Proxy
echo "🔗 Starting Cloud SQL Proxy..."
echo "   This will run in the background on port 5433"
./cloud-sql-proxy ats-fit-backend:asia-south1:ats-fit-postgres --port 5433 &
PROXY_PID=$!

# Wait for proxy to be ready
echo "⏳ Waiting for proxy to be ready..."
sleep 5

# Step 4: Test connection
echo "🔍 Testing database connection..."
if pg_isready -h localhost -p 5433 -U postgres > /dev/null 2>&1; then
    echo "✅ Database connection successful!"
    
    echo ""
    echo "🎯 Ready to run migrations! Execute these commands:"
    echo ""
    echo "   # Run migrations"
    echo "   env $(cat .env.migration | xargs) npm run migration:run"
    echo ""
    echo "   # Run seeding"
    echo "   env $(cat .env.migration | xargs) npm run seed:templates"
    echo "   env $(cat .env.migration | xargs) npm run seed:rate-limits"
    echo ""
    echo "   # Stop proxy when done"
    echo "   kill $PROXY_PID"
    echo ""
    echo "📝 Proxy PID: $PROXY_PID (save this to stop it later)"
    
else
    echo "❌ Database connection failed"
    kill $PROXY_PID
    exit 1
fi