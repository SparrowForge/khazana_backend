import { applyDecorators } from '@nestjs/common';
import { IsString, MinLength, Matches } from 'class-validator';

/**
 * Shared password-strength policy — single source of truth for every DTO that
 * sets a password (create user, change password, reset password). Mirrors the
 * frontend checks: min 8 chars, at least one uppercase, one lowercase, one number.
 */
export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: 'Password must be at least 8 characters' }),
    Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
      message:
        'Password must contain at least one uppercase letter, one lowercase letter, and one number',
    }),
  );
}
