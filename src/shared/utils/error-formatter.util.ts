// src/common/utils/format-unknown-error.util.ts
export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'number' || typeof error === 'boolean') {
    return error.toString();
  }

  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return '[Unserializable Object]';
    }
  }

  return '[Unknown error type]';
}
