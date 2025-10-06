#!/bin/bash

# Post-deployment configuration and testing script

PROJECT_ID="ats-fit-backend"
SERVICE_NAME="ats-fit-backend"
REGION="asia-south1"  # Mumbai, India - Best for Pakistan

echo "🔧 Configuring Cloud Run service..."

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
    --region=$REGION \
    --format="value(status.url)")

echo "📍 Service URL: $SERVICE_URL"

# Configure custom domain (optional)
# gcloud run domain-mappings create \
#     --service=$SERVICE_NAME \
#     --domain=api.yourdomain.com \
#     --region=$REGION

# Test health endpoint
echo "🏥 Testing health endpoint..."
curl -f $SERVICE_URL/health || echo "❌ Health check failed"

# Test API documentation
echo "📚 API Documentation: $SERVICE_URL/api/docs"

# Configure monitoring alerts
echo "📊 Setting up monitoring..."
gcloud alpha monitoring policies create --policy-from-file=monitoring-policy.yaml

# Set up log-based metrics
gcloud logging metrics create error_rate \
    --description="Rate of application errors" \
    --log-filter='resource.type="cloud_run_revision" AND severity>=ERROR'

echo "✅ Post-deployment configuration completed!"
echo ""
echo "🌐 Your API is now live at: $SERVICE_URL"
echo "📊 Swagger docs: $SERVICE_URL/api/docs"
echo "🏥 Health check: $SERVICE_URL/health"
echo ""
echo "📋 Next steps:"
echo "1. Update your frontend to use: $SERVICE_URL"
echo "2. Configure your custom domain (if needed)"
echo "3. Set up monitoring dashboards"
echo "4. Configure CI/CD pipeline"