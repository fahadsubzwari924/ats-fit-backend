#!/usr/bin/env node

/**
 * Test script to debug subscription creation
 * 
 * This script will send test webhook payloads to help identify why subscriptions aren't being created
 */

const testWebhookPayloads = {
  // Test 1: subscription_created event
  subscriptionCreated: {
    "meta": {
      "event_name": "subscription_created",
      "test_mode": true
    },
    "data": {
      "id": "sub_test_123",
      "type": "subscriptions", 
      "attributes": {
        "status": "active",
        "created_at": "2025-10-05T10:00:00Z",
        "renews_at": "2025-11-05T10:00:00Z",
        "ends_at": "2025-11-05T10:00:00Z",
        "currency": "USD",
        "total": 3499, // $34.99
        "custom_data": {
          "user_id": "test-user-uuid-123",
          "plan_id": "test-plan-uuid-456"
        }
      }
    }
  },

  // Test 2: subscription_payment_success event  
  paymentSuccess: {
    "meta": {
      "event_name": "subscription_payment_success",
      "test_mode": true
    },
    "data": {
      "id": "sub_test_456", 
      "type": "subscription_invoices",
      "attributes": {
        "status": "paid",
        "created_at": "2025-10-05T10:00:00Z",
        "currency": "USD", 
        "total": 3499, // $34.99
        "subscription_item_price": 3499,
        "custom_data": {
          "user_id": "test-user-uuid-789",
          "plan_id": "test-plan-uuid-101"
        }
      }
    }
  },

  // Test 3: Alternative custom data location
  alternativeCustomData: {
    "meta": {
      "event_name": "subscription_payment_success",
      "test_mode": true,
      "custom_data": {
        "user_id": "test-user-uuid-alternative",
        "plan_id": "test-plan-uuid-alternative"
      }
    },
    "data": {
      "id": "sub_test_789",
      "type": "subscription_invoices", 
      "attributes": {
        "status": "paid",
        "created_at": "2025-10-05T10:00:00Z",
        "currency": "USD",
        "total": 3499,
        "checkout_data": {
          "custom": {
            "user_id": "test-user-checkout-123",
            "plan_id": "test-plan-checkout-456"
          }
        }
      }
    }
  }
};

console.log('🧪 Test Webhook Payloads for Debugging Subscription Creation');
console.log('='.repeat(60));

console.log('\n1️⃣ Test with subscription_created event:');
console.log('POST /api/webhooks/lemon-squeezy/test');
console.log('Content-Type: application/json');
console.log(JSON.stringify(testWebhookPayloads.subscriptionCreated, null, 2));

console.log('\n2️⃣ Test with subscription_payment_success event:');
console.log('POST /api/webhooks/lemon-squeezy/test');  
console.log('Content-Type: application/json');
console.log(JSON.stringify(testWebhookPayloads.paymentSuccess, null, 2));

console.log('\n3️⃣ Test with alternative custom data location:');
console.log('POST /api/webhooks/lemon-squeezy/test');
console.log('Content-Type: application/json'); 
console.log(JSON.stringify(testWebhookPayloads.alternativeCustomData, null, 2));

console.log('\n📝 Instructions:');
console.log('1. Make sure your server is running (npm run start:dev)');
console.log('2. Use Postman/curl to send these payloads to your test webhook endpoint');
console.log('3. Check the server logs for detailed debugging information');
console.log('4. Verify if subscription entries are created in your database');

console.log('\n🐛 Debugging Checklist:');
console.log('✓ Check if PaymentHistory entries are created');
console.log('✓ Check if custom data is extracted properly');
console.log('✓ Verify user_id and plan_id exist in your database'); 
console.log('✓ Check subscription service create method logs');
console.log('✓ Verify database connection and table structure');

console.log('\n📋 Example curl command:');
console.log(`curl -X POST http://localhost:3000/api/webhooks/lemon-squeezy/test \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(testWebhookPayloads.subscriptionCreated)}'`);