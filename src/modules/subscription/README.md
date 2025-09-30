# LemonSqueezy Payment Integration (Simplified - No Database)

This module provides a simplified integration with LemonSqueezy's hosted checkout using only the LemonSqueezy API (no database storage yet).

## Features

- ✅ Hosted checkout (LemonSqueezy handles the payment form)
- ✅ Basic subscription management via LemonSqueezy API
- ✅ Subscription cancellation
- ✅ Customer portal access
- ✅ Type-safe API with Swagger documentation

## Current API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/billing/checkout` | Create checkout session |
| GET | `/billing/subscriptions/:id` | Get subscription details |
| DELETE | `/billing/subscriptions/:id` | Cancel subscription |
| GET | `/billing/customer/:id/portal` | Get customer portal URL |

## Usage

### 1. Create Checkout Session

```bash
POST /billing/checkout
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "planId": "variant_12345",  // LemonSqueezy variant ID
  "metadata": {
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

**Response:**
```json
{
  "checkoutUrl": "https://checkout.lemonsqueezy.com/checkout/...",
  "message": "Redirect user to checkoutUrl to complete payment",
  "success": true
}
```

### 2. Frontend Implementation

```javascript
const handleSubscribe = async () => {
  const response = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      planId: 'variant_12345',
      metadata: {
        email: 'user@example.com',
        name: 'John Doe'
      }
    })
  });
  
  const data = await response.json();
  
  // Redirect to LemonSqueezy checkout
  if (data.success) {
    window.location.href = data.checkoutUrl;
  }
};
```

### 3. Check Subscription Status

```bash
GET /billing/subscriptions/sub_12345
Authorization: Bearer <jwt_token>
```

### 4. Cancel Subscription

```bash
DELETE /billing/subscriptions/sub_12345
Authorization: Bearer <jwt_token>
```

### 5. Get Customer Portal

```bash
GET /billing/customer/cust_12345/portal
Authorization: Bearer <jwt_token>
```

## Environment Variables

Required in `.env.dev`:
```bash
LEMON_SQUEEZY_API_KEY=your_api_key
LEMON_SQUEEZY_STORE_ID=your_store_id
```

## What's Next?

After testing the LemonSqueezy integration:
1. Add database integration for storing subscription data locally
2. Add webhook handling for real-time updates
3. Add payment history tracking
4. Add more advanced subscription management features

## Testing

1. Get your LemonSqueezy test API key and store ID
2. Create a product with variants in your LemonSqueezy store
3. Use the variant ID in the API calls
4. Test with LemonSqueezy's test mode