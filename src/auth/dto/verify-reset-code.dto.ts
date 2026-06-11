import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyResetCodeDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '847291', description: '6-digit password reset code from email' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'Code must be exactly 6 digits' })
  code: string;
}
