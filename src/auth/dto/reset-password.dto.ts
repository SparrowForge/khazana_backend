import { IsEmail, IsNotEmpty, IsString, Length, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '847291', description: '6-digit reset code from email' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'Code must be exactly 6 digits' })
  code: string;

  @ApiProperty({ example: 'NewSecure@123', description: 'New password (min 8 chars)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  newPassword: string;
}
