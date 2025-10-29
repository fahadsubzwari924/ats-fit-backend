/**
 * Queue Message Enums and Types
 *
 * Shared enums and types for queue message status and priority.
 * These are used across the application for consistent queue management.
 */

/**
 * Queue message status lifecycle
 */
export enum QueueMessageStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

/**
 * Type definition for queue message status
 * @deprecated Use QueueMessageStatus enum instead
 */
export type QueueMessageStatusType =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retrying';

/**
 * Queue message priority levels
 */
export enum QueueMessagePriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Type definition for queue message priority
 * @deprecated Use QueueMessagePriority enum instead
 */
export type QueueMessagePriorityType = 'low' | 'normal' | 'high' | 'critical';
