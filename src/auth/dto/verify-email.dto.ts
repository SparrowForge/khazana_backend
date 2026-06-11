import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ example: 'a3f8b2c1d4...', description: 'Email verification token from the link' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
