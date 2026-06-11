import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResendVerificationDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email address to send verification link to' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
