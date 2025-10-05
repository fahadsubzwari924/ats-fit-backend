#!/bin/bash

# Database Migration Script for Cloud SQL
# This script runs migrations on your Cloud SQL instance

PROJECT_ID="ats-fit-backend"
INSTANCE_NAME="ats-fit-postgres"
DATABASE_NAME="ats_fit"

echo "🔄 Running database migrations on Cloud SQL..."

# Get Cloud SQL connection details
CONNECTION_NAME="$PROJECT_ID:asia-south1:$INSTANCE_NAME"

# Run migrations using Cloud SQL Proxy
echo "📊 Starting Cloud SQL Proxy..."
cloud_sql_proxy -instances=$CONNECTION_NAME=tcp:5433 &
PROXY_PID=$!

# Wait for proxy to start
sleep 10

# Set environment variables for migration
export DATABASE_HOST=localhost
export DATABASE_PORT=5433
export DATABASE_NAME=$DATABASE_NAME
export DATABASE_USERNAME=postgres
export DATABASE_PASSWORD=$(gcloud secrets versions access latest --secret="database-password")

# Run TypeORM migrations
echo "🚀 Running migrations..."
npm run migration:run

# Clean up
kill $PROXY_PID

echo "✅ Database migrations completed!"