import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  MinLength,
  IsEmail,
  IsArray,
  IsUUID,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'john.doe', description: 'Unique username for login' })
  @IsString()
  @IsNotEmpty()
  userName: string;

  @ApiProperty({ example: 'secret123', description: 'Password (min 6 characters)', minLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'john@example.com', description: 'Email address (used for verification and password reset)' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Display name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    description: 'UUIDs of branches the user can access (at least one required)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  branchIds: string[];

  @ApiPropertyOptional({ example: '2025-12-31', description: 'Account expiry date (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  validUntil?: string;

  @ApiPropertyOptional({ example: 'Sales team member', description: 'Optional remarks' })
  @IsString()
  @IsOptional()
  remarks?: string;
}
