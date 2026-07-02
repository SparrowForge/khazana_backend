import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStrongPassword } from '../../common/decorators';

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

  @ApiProperty({
    example: 'NewSecure@123',
    description: 'New password (min 8 chars, with uppercase, lowercase, and a number)',
    minLength: 8,
  })
  @IsNotEmpty()
  @IsStrongPassword()
  newPassword: string;
}
