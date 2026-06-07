import { PartialType, OmitType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['password'] as const)) {
  @ApiPropertyOptional({ example: '1', description: 'Active status (1 = active, 0 = inactive)' })
  @IsOptional()
  @IsString()
  isActive?: string;
}
