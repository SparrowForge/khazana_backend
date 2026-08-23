import { IsString, IsNotEmpty, IsUUID, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Google Sign-In sends an **ID token** (a signed JWT), not an access token. The
 * browser never tells us who the user is — the token is verified server-side
 * against Google's public keys, and only the email inside a valid, unexpired
 * token signed for OUR client id is trusted.
 */
export class GoogleCredentialDto {
  @ApiProperty({ description: 'The `credential` field from Google Identity Services' })
  @IsString()
  @IsNotEmpty()
  credential: string;
}

export class GoogleLoginDto extends GoogleCredentialDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Branch to sign in at. Optional when the account is mapped to exactly one branch; '
      + 'otherwise call /auth/google/branches first and let the user pick.',
  })
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
