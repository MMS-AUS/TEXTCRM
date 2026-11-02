import { TRPCClientError } from '@trpc/client';

/**
 * A message for the user from a failed API call. The API's own messages are written for users
 * (and hide internals outside development); anything else gets a generic retry message.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof TRPCClientError && error.message) {
    return error.message === 'Failed to fetch'
      ? "Can't reach the CRM server. Check your connection and try again."
      : error.message;
  }
  return 'Something went wrong. Please try again.';
}
