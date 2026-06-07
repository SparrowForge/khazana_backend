import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'oldPassword123', description: 'Current password' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ example: 'newPassword123', description: 'New password (min 6 characters)', minLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}
