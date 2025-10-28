# Payment Gateway Agnostic Architecture

This document explains the changes made to make the subscription system payment gateway agnostic.

## Problem

The original implementation had payment gateway-specific column names and method names:
- `lemon_squeezy_variant_id` → Specific to LemonSqueezy
- `lemon_squeezy_id` → Specific to LemonSqueezy
- Method names like `findByLemonSqueezyId()` → Tightly coupled

This made it difficult to switch payment gateways without significant code changes.

## Solution

### 1. Generic Column Names

**Before:**
```typescript
// Entities
lemonSqueezyVariantId: string;
lemonSqueezyId: string;

// Database columns
lemon_squeezy_variant_id
lemon_squeezy_id
```

**After:**
```typescript
// Entities
externalVariantId: string;        // Generic variant ID from any payment gateway
externalSubscriptionId: string;   // Generic subscription ID from any payment gateway

// Database columns
external_variant_id
external_subscription_id
```

### 2. Generic Method Names

**Before:**
```typescript
findByLemonSqueezyId(id: string)
findByLemonSqueezyVariantId(variantId: string)
updateByLemonSqueezyId(id: string, data: UpdateData)
```

**After:**
```typescript
findByExternalId(id: string)           // Works with any payment gateway
findByExternalVariantId(variantId: string)  // Works with any payment gateway
updateByExternalId(id: string, data: UpdateData)     // Works with any payment gateway
```

### 3. Generic Interface Properties

**Before:**
```typescript
interface ICreateSubscriptionData {
  lemonSqueezyId: string;
  // ...
}

interface ICreateSubscriptionPlanData {
  lemonSqueezyVariantId: string;
  // ...
}
```

**After:**
```typescript
interface ICreateSubscriptionData {
  externalSubscriptionId: string;    // Payment gateway agnostic
  // ...
}

interface ICreateSubscriptionPlanData {
  externalVariantId: string;         // Payment gateway agnostic
  // ...
}
```

## Files Modified

### Entities
- `subscription-plan.entity.ts` - Updated column names and properties
- `user-subscription.entity.ts` - Updated column names and indexes

### Services
- `subscription.service.ts` - Updated method names and implementations
- `subscription-plan.service.ts` - Updated method names
- `webhook.service.ts` - Updated to use generic methods
- `payment-history.service.ts` - Updated method calls

### DTOs
- `subscription-plan.dto.ts` - Updated property names and descriptions

### Interfaces
- `subscription.interface.ts` - Updated all interface properties

### Controllers
- `subscription.controller.ts` - Updated to use generic properties

### Seed Files
- `seed-subscription-plans.ts` - Updated to use generic property names
- `seed-subscription-plans-service.ts` - Updated to use generic property names

### Database Migration
- `1728518500000-rename-payment-gateway-columns.ts` - Handles database schema changes

## Benefits

### 1. **Payment Gateway Flexibility**
```typescript
// Easy to switch from LemonSqueezy to Stripe
const subscription = await subscriptionService.findByExternalId('stripe_sub_123');

// Or use with PayPal
const subscription = await subscriptionService.findByExternalId('paypal_sub_456');
```

### 2. **Clean Code**
- No payment gateway-specific names in business logic
- Generic interfaces that work with any provider
- Consistent naming conventions

### 3. **Future-Proof**
- Adding new payment gateways doesn't require renaming
- Business logic remains unchanged when switching providers
- Database schema is provider-agnostic

### 4. **Migration Support**
- Database migration handles column renaming automatically
- Includes rollback functionality
- Updates all indexes and constraints

## Usage Examples

### Creating a Subscription Plan (Any Gateway)
```typescript
const planData: ICreateSubscriptionPlanData = {
  planName: 'Premium Plan',
  description: 'Full access to all features',
  price: 29.99,
  currency: 'USD',
  externalVariantId: 'stripe_price_123',  // Could be any gateway ID
  billingCycle: BillingCycle.MONTHLY,
  features: ['Feature 1', 'Feature 2']
};
```

### Creating a Subscription (Any Gateway)
```typescript
const subscriptionData: ICreateSubscriptionData = {
  externalSubscriptionId: 'stripe_sub_123',  // Could be any gateway ID
  subscriptionPlanId: 'plan-uuid',
  userId: 'user-uuid',
  status: SubscriptionStatus.ACTIVE,
  amount: 29.99,
  currency: 'USD',
  startsAt: new Date(),
  endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
};
```

## Migration Instructions

1. **Run the migration:**
   ```bash
   npm run migration:run
   ```

2. **Update existing data** (if needed):
   - The migration only renames columns
   - Data remains intact
   - No data transformation required

3. **Test the changes:**
   - Verify all API endpoints work
   - Check webhook processing
   - Confirm subscription creation/management

## Implementation Notes

- **Backward Compatibility**: The migration includes rollback functionality
- **Index Updates**: All database indexes are updated to use new column names
- **Constraint Updates**: Unique constraints are properly renamed
- **Type Safety**: All TypeScript interfaces maintain type safety
- **Documentation**: API documentation (Swagger) updated with generic descriptions

This architecture now supports easy switching between payment gateways like LemonSqueezy, Stripe, PayPal, Paddle, or any custom payment solution.