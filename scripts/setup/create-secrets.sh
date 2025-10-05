#!/bin/bash

# Script to create secrets in Google Secret Manager for sensitive environment variables
# This is a more secure approach than hardcoding secrets in deployment files

PROJECT_ID="ats-fit-backend"

echo "🔒 Creating secrets in Google Secret Manager..."

# Database credentials
echo -n "postgres" | gcloud secrets create database-username --data-file=-
echo -n "YOUR_DATABASE_PASSWORD_HERE" | gcloud secrets create database-password --data-file=-

# JWT secret
echo -n "YOUR_JWT_SECRET_HERE" | gcloud secrets create jwt-secret --data-file=-

# OpenAI API key
echo -n "YOUR_OPENAI_API_KEY_HERE" | gcloud secrets create openai-api-key --data-file=-

# Anthropic API key
echo -n "YOUR_ANTHROPIC_API_KEY_HERE" | gcloud secrets create anthropic-api-key --data-file=-

# AWS credentials
echo -n "YOUR_AWS_ACCESS_KEY_ID_HERE" | gcloud secrets create aws-access-key-id --data-file=-
echo -n "YOUR_AWS_SECRET_ACCESS_KEY_HERE" | gcloud secrets create aws-secret-access-key --data-file=-

# Redis password
echo -n "YOUR_REDIS_PASSWORD_HERE" | gcloud secrets create redis-password --data-file=-

echo "✅ Secrets created successfully!"
echo ""
echo "📋 To grant access to your Cloud Run service account:"
echo "SERVICE_ACCOUNT=ats-fit-service-account@$PROJECT_ID.iam.gserviceaccount.com"
echo ""
echo "for secret in database-username database-password jwt-secret openai-api-key anthropic-api-key aws-access-key-id aws-secret-access-key redis-password; do"
echo "  gcloud secrets add-iam-policy-binding \$secret \\"
echo "    --member=\"serviceAccount:\$SERVICE_ACCOUNT\" \\"
echo "    --role=\"roles/secretmanager.secretAccessor\""
echo "done"