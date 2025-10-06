#!/bin/bash

# Migration script for Cloud Run Job
set -e

echo "🚀 Starting database migrations..."

# Wait for database to be ready
echo "⏳ Waiting for database connection..."
until pg_isready -h /cloudsql/ats-fit-backend:asia-south1:ats-fit-postgres -U postgres; do
  echo "   Database not ready, waiting..."
  sleep 2
done

echo "✅ Database connection established!"

# Run TypeORM migrations
echo "📊 Running database migrations..."
npm run migration:run

echo "🌱 Running seed scripts..."

# Run resume templates seeding
echo "   → Seeding resume templates..."
npm run seed:templates

# Run rate limits seeding  
echo "   → Seeding rate limits..."
npm run seed:rate-limits

echo "✅ All migrations and seeding completed successfully!"