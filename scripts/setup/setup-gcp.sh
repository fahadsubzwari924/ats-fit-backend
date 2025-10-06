#!/bin/bash

# Google Cloud Setup Script for ATS Fit Backend
# This script creates all necessary GCP resources for the application

# Configuration
PROJECT_ID="ats-fit-backend"
REGION="asia-south1"  # Mumbai, India - Best for Pakistan
DATABASE_INSTANCE="ats-fit-postgres"
DATABASE_NAME="ats_fit"
REDIS_INSTANCE="ats-fit-redis"
SERVICE_ACCOUNT="ats-fit-service-account"

echo "🚀 Setting up Google Cloud resources for ATS Fit Backend..."

# Set project
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "📡 Enabling Google Cloud APIs..."
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    sqladmin.googleapis.com \
    redis.googleapis.com \
    secretmanager.googleapis.com \
    storage.googleapis.com \
    containerregistry.googleapis.com

# Create service account
echo "👤 Creating service account..."
if gcloud iam service-accounts describe $SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com >/dev/null 2>&1; then
    echo "✅ Service account '$SERVICE_ACCOUNT' already exists!"
else
    gcloud iam service-accounts create $SERVICE_ACCOUNT \
        --display-name="ATS Fit Backend Service Account" \
        --description="Service account for ATS Fit Backend on Cloud Run"
    echo "✅ Service account created successfully!"
fi

# Grant necessary permissions
echo "🔐 Granting IAM permissions..."
SERVICE_ACCOUNT_EMAIL="$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"

echo "   Adding Cloud SQL client role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/cloudsql.client" \
    --condition=None >/dev/null 2>&1 || echo "   Role already exists or failed to add"

echo "   Adding Redis editor role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/redis.editor" \
    --condition=None >/dev/null 2>&1 || echo "   Role already exists or failed to add"

echo "   Adding Secret Manager accessor role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None >/dev/null 2>&1 || echo "   Role already exists or failed to add"

echo "✅ IAM permissions configured!"

# Create Cloud SQL instance
echo "🐘 Creating Cloud SQL PostgreSQL instance..."
if gcloud sql instances describe $DATABASE_INSTANCE >/dev/null 2>&1; then
    echo "✅ Cloud SQL instance '$DATABASE_INSTANCE' already exists!"
else
    gcloud sql instances create $DATABASE_INSTANCE \
        --database-version=POSTGRES_15 \
        --tier=db-f1-micro \
        --region=$REGION \
        --storage-type=SSD \
        --storage-size=20GB \
        --storage-auto-increase \
        --backup-start-time=03:00 \
        --maintenance-window-day=SUN \
        --maintenance-window-hour=04 \
        --deletion-protection
    echo "✅ Cloud SQL instance created successfully!"
fi

# Create database
echo "📊 Creating database..."
if gcloud sql databases describe $DATABASE_NAME --instance=$DATABASE_INSTANCE >/dev/null 2>&1; then
    echo "✅ Database '$DATABASE_NAME' already exists!"
else
    gcloud sql databases create $DATABASE_NAME --instance=$DATABASE_INSTANCE
    echo "✅ Database created successfully!"
fi

# Create database user
echo "👨‍💻 Creating database user..."
if gcloud sql users describe postgres --instance=$DATABASE_INSTANCE >/dev/null 2>&1; then
    echo "✅ Database user 'postgres' already exists!"
    # Get existing password from secret if available
    DB_PASSWORD=$(gcloud secrets versions access latest --secret="database-password" 2>/dev/null || openssl rand -base64 32)
else
    DB_PASSWORD=$(openssl rand -base64 32)
    gcloud sql users create postgres \
        --instance=$DATABASE_INSTANCE \
        --password=$DB_PASSWORD
    echo "✅ Database user created successfully!"
fi

# Create Redis instance
echo "🔴 Creating Redis instance..."
if gcloud redis instances describe $REDIS_INSTANCE --region=$REGION >/dev/null 2>&1; then
    echo "✅ Redis instance '$REDIS_INSTANCE' already exists!"
else
    gcloud redis instances create $REDIS_INSTANCE \
        --region=$REGION \
        --size=1 \
        --network=projects/$PROJECT_ID/global/networks/default \
        --redis-version=redis_6_x \
        --connect-mode=DIRECT_PEERING \
        --display-name="ATS Fit Redis Cache"
    
    if [ $? -eq 0 ]; then
        echo "✅ Redis instance creation initiated!"
        echo "⏳ Redis will take 5-10 minutes to be ready..."
    else
        echo "❌ Failed to create Redis instance"
        echo "⚠️  Continuing with other resources..."
    fi
fi

# Create Storage buckets (if using Google Cloud Storage instead of AWS S3)
echo "🪣 Creating Storage buckets..."
if gsutil ls gs://$PROJECT_ID-resume-templates >/dev/null 2>&1; then
    echo "✅ Bucket '$PROJECT_ID-resume-templates' already exists!"
else
    gsutil mb -p $PROJECT_ID -c STANDARD -l $REGION gs://$PROJECT_ID-resume-templates
    echo "✅ Resume templates bucket created!"
fi

if gsutil ls gs://$PROJECT_ID-generated-resumes >/dev/null 2>&1; then
    echo "✅ Bucket '$PROJECT_ID-generated-resumes' already exists!"
else
    gsutil mb -p $PROJECT_ID -c STANDARD -l $REGION gs://$PROJECT_ID-generated-resumes
    echo "✅ Generated resumes bucket created!"
fi

# Set bucket permissions
gsutil iam ch serviceAccount:$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com:objectAdmin gs://$PROJECT_ID-resume-templates
gsutil iam ch serviceAccount:$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com:objectAdmin gs://$PROJECT_ID-generated-resumes

# Create secrets in Secret Manager
echo "🔒 Creating secrets..."

# Database credentials
if gcloud secrets describe database-username >/dev/null 2>&1; then
    echo "✅ Secret 'database-username' already exists!"
else
    echo -n "postgres" | gcloud secrets create database-username --data-file=-
    echo "✅ Database username secret created!"
fi

if gcloud secrets describe database-password >/dev/null 2>&1; then
    echo "✅ Secret 'database-password' already exists!"
else
    echo -n "$DB_PASSWORD" | gcloud secrets create database-password --data-file=-
    echo "✅ Database password secret created!"
fi

# JWT secret
if gcloud secrets describe jwt-secret >/dev/null 2>&1; then
    echo "✅ Secret 'jwt-secret' already exists!"
    JWT_SECRET=$(gcloud secrets versions access latest --secret="jwt-secret")
else
    JWT_SECRET=$(openssl rand -base64 64)
    echo -n "$JWT_SECRET" | gcloud secrets create jwt-secret --data-file=-
    echo "✅ JWT secret created!"
fi

# Redis host (will be filled after Redis instance is ready)
echo "🔄 Checking Redis instance status..."
REDIS_HOST=""
for i in {1..10}; do
    REDIS_STATUS=$(gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --format="value(state)" 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$REDIS_STATUS" = "READY" ]; then
        REDIS_HOST=$(gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --format="value(host)")
        echo "✅ Redis instance is ready! Host: $REDIS_HOST"
        
        if gcloud secrets describe redis-host >/dev/null 2>&1; then
            echo "✅ Secret 'redis-host' already exists!"
        else
            echo -n "$REDIS_HOST" | gcloud secrets create redis-host --data-file=-
            echo "✅ Redis host secret created!"
        fi
        break
    elif [ "$REDIS_STATUS" = "NOT_FOUND" ]; then
        echo "⚠️  Redis instance not found - skipping Redis host secret"
        break
    else
        echo "   Redis status: $REDIS_STATUS (attempt $i/10)"
        if [ $i -lt 10 ]; then
            sleep 30
        fi
    fi
done

if [ -z "$REDIS_HOST" ] && [ "$REDIS_STATUS" != "NOT_FOUND" ]; then
    echo "⚠️  Redis is still not ready after 5 minutes"
    echo "   You can get the Redis IP later with:"
    echo "   gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --format=\"value(host)\""
    echo "   Then create the secret manually:"
    echo "   echo -n \"REDIS_IP\" | gcloud secrets create redis-host --data-file=-"
fi

# OpenAI API key (you'll need to update this manually)
echo "⚠️  Please create the OpenAI API key secret manually:"
echo "gcloud secrets create openai-api-key --data-file=- <<< 'your-openai-api-key'"

# AWS credentials (if using AWS S3)
echo "⚠️  Please create AWS credentials secrets manually:"
echo "gcloud secrets create aws-access-key-id --data-file=- <<< 'your-aws-access-key'"
echo "gcloud secrets create aws-secret-access-key --data-file=- <<< 'your-aws-secret-key'"

# Grant secret access to service account
echo "🔐 Granting secret access permissions..."
for secret in database-username database-password jwt-secret redis-host openai-api-key aws-access-key-id aws-secret-access-key; do
    if gcloud secrets describe $secret >/dev/null 2>&1; then
        echo "   Adding access to secret: $secret"
        gcloud secrets add-iam-policy-binding $secret \
            --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
            --role="roles/secretmanager.secretAccessor" >/dev/null 2>&1 || echo "   Permission already exists or failed to add"
    fi
done
echo "✅ Secret access permissions configured!"

echo "✅ Google Cloud setup completed!"
echo ""
echo "📋 Next steps:"
echo "1. Update the OpenAI API key secret"
echo "2. Update AWS credentials secrets (if using AWS S3)"
echo "3. Update PROJECT_ID in cloudbuild.yaml and cloud-run-service.yaml"
echo "4. Run: gcloud builds submit --config cloudbuild.yaml"
echo ""
echo "📊 Resource summary:"
echo "- Cloud SQL instance: $DATABASE_INSTANCE"
echo "- Redis instance: $REDIS_INSTANCE"  
echo "- Service account: $SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"
echo "- Database password: $DB_PASSWORD"
echo "- JWT secret: $JWT_SECRET"
echo "- Redis host: $REDIS_HOST"