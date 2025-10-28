# Snake Case Conversion Guide

This document outlines the conversion from camelCase to snake_case for all entity properties to maintain consistent database naming conventions.

## ⚠️ BREAKING CHANGES

This is a major refactoring that affects all database interactions. All services, interfaces, and DTOs need to be updated.

## Entity Changes

### UserSubscription Entity
**Before:**
```typescript
externalSubscriptionId: string;
startsAt: Date;
endsAt: Date;
isActive: boolean;
isCancelled: boolean;
userId: string;
subscriptionPlanId: string;
createdAt: Date;
updatedAt: Date;
```

**After:**
```typescript
external_subscription_id: string;
starts_at: Date;
ends_at: Date;
is_active: boolean;
is_cancelled: boolean;
user_id: string;
subscription_plan_id: string;
created_at: Date;
updated_at: Date;
```

### SubscriptionPlan Entity
**Before:**
```typescript
planName: string;
externalVariantId: string;
isActive: boolean;
billingCycle: BillingCycle;
createdAt: Date;
updatedAt: Date;
```

**After:**
```typescript
plan_name: string;
external_variant_id: string;
is_active: boolean;
billing_cycle: BillingCycle;
created_at: Date;
updated_at: Date;
```

### PaymentHistory Entity
**Before:**
```typescript
lemonSqueezyId: string;           // Also renamed for gateway agnostic
paymentType: PaymentType;
userId: string;
subscriptionPlanId: string;
lemonSqueezyPayload: Record<>;    // Also renamed for gateway agnostic
customerEmail: string;
isTestMode: boolean;
processedAt: Date;
retryCount: number;
lastRetryAt: Date;
processingError: string;
createdAt: Date;
updatedAt: Date;
```

**After:**
```typescript
external_payment_id: string;          // Generic payment gateway ID
payment_type: PaymentType;
user_id: string;
subscription_plan_id: string;
external_payment_payload: Record<>;   // Generic payment gateway payload
customer_email: string;
is_test_mode: boolean;
processed_at: Date;
retry_count: number;
last_retry_at: Date;
processing_error: string;
created_at: Date;
updated_at: Date;
```

## Required Code Updates

### 1. Service Layer Updates

**Subscription Service:**
```typescript
// OLD
subscription.externalSubscriptionId
subscription.startsAt
subscription.endsAt
subscription.isActive
subscription.userId

// NEW
subscription.external_subscription_id
subscription.starts_at
subscription.ends_at
subscription.is_active
subscription.user_id
```

**Subscription Plan Service:**
```typescript
// OLD
plan.planName
plan.externalVariantId
plan.isActive
plan.billingCycle

// NEW
plan.plan_name
plan.external_variant_id
plan.is_active
plan.billing_cycle
```

**Payment History Service:**
```typescript
// OLD
payment.lemonSqueezyId
payment.paymentType
payment.userId
payment.lemonSqueezyPayload
payment.processedAt

// NEW
payment.external_payment_id
payment.payment_type
payment.user_id
payment.external_payment_payload
payment.processed_at
```

### 2. Interface Updates

**ICreateSubscriptionData:**
```typescript
interface ICreateSubscriptionData {
  external_subscription_id: string;  // was: externalSubscriptionId
  subscription_plan_id: string;      // was: subscriptionPlanId
  user_id: string;                   // was: userId
  starts_at: Date;                   // was: startsAt
  ends_at: Date;                     // was: endsAt
  // ... other fields
}
```

**ICreateSubscriptionPlanData:**
```typescript
interface ICreateSubscriptionPlanData {
  plan_name: string;              // was: planName
  external_variant_id: string;   // was: externalVariantId
  is_active?: boolean;            // was: isActive
  billing_cycle?: BillingCycle;   // was: billingCycle
  // ... other fields
}
```

### 3. DTO Updates

All DTOs need property name updates:
```typescript
// CreateSubscriptionPlanDto, UpdateSubscriptionPlanDto, etc.
@ApiProperty({ description: 'Plan name' })
plan_name: string;  // was: planName

@ApiProperty({ description: 'External variant ID' })
external_variant_id: string;  // was: externalVariantId
```

### 4. Controller Updates

```typescript
// Update all property access
const checkoutResponse = await this.paymentService.createCheckout({
  variantId: subscriptionPlan.external_variant_id,  // was: externalVariantId
  // ...
});
```

### 5. Webhook Service Updates

```typescript
// Update webhook processing
const subscriptionData: ICreateSubscriptionData = {
  external_subscription_id: payload?.data?.id,  // was: externalSubscriptionId
  subscription_plan_id: planId,                  // was: subscriptionPlanId
  user_id: userId,                               // was: userId
  starts_at: new Date(payload.data.attributes.starts_at),  // was: startsAt
  ends_at: new Date(payload.data.attributes.ends_at),      // was: endsAt
  // ...
};
```

## Database Migration

Run the migration to update column indexes and constraints:
```bash
npm run migration:run
```

**Note:** The entity property names have changed, but the actual database column names remain the same (they were already in snake_case). Only indexes and constraints are updated for consistency.

## Testing Checklist

After making all updates:

- [ ] All services compile without errors
- [ ] All API endpoints return correct property names
- [ ] Webhook processing works correctly
- [ ] Database queries use correct property names
- [ ] All tests pass
- [ ] Swagger documentation shows correct property names

## Rollback Plan

If issues arise, you can rollback the migration:
```bash
npm run migration:revert
```

Then revert the code changes by switching back to camelCase property names.

## Benefits

1. **Consistency**: All entity properties now match database column naming conventions
2. **Clarity**: Clear distinction between database fields and business logic
3. **Standards**: Follows common database naming practices
4. **Maintainability**: Easier to understand data flow between database and application

## Implementation Steps

1. **Run Migration**: Update database indexes and constraints
2. **Update Entities**: Already completed (snake_case properties)
3. **Update Interfaces**: Convert all interface properties to snake_case
4. **Update Services**: Update all property access in services
5. **Update DTOs**: Convert DTO properties to snake_case
6. **Update Controllers**: Update property access in controllers
7. **Update Webhooks**: Update webhook data processing
8. **Update Seed Files**: Update seed data to use snake_case properties
9. **Test**: Run comprehensive tests
10. **Deploy**: Deploy with proper migration sequencing

This conversion ensures your codebase maintains consistent naming conventions throughout the entire application stack.