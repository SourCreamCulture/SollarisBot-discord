/**
 * An error whose message is safe to show directly to a user in Discord.
 *
 * The central interaction handler surfaces the message of a `UserFacingError`
 * (and of domain errors like `ApexError`) verbatim. Any other thrown error is
 * treated as unexpected: it is logged in full and the user sees a generic
 * message instead, so internal details and stack traces never leak.
 */
export class UserFacingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UserFacingError';
  }
}

export const isUserFacingError = (error: unknown): error is UserFacingError =>
  error instanceof UserFacingError;
