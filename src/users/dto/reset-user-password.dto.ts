import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStrongPassword } from '../../common/decorators';

export class ResetUserPasswordDto {
  @ApiProperty({
    example: 'NewSecure@123',
    description: 'New password (min 8 chars, with uppercase, lowercase, and a number)',
    minLength: 8,
  })
  @IsNotEmpty()
  @IsStrongPassword()
  password: string;
}
