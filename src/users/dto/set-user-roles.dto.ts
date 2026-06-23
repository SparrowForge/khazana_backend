import { IsArray, ValidateNested, ArrayNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserRoleDto {
  @ApiProperty({ example: 'SalesForm', description: 'Control/form name for the permission' })
  @IsString()
  controlName: string;

  @ApiPropertyOptional({ example: '1', description: 'Enable access (1 = yes)' })
  @IsString()
  @IsOptional()
  isEnable?: string;

  @ApiPropertyOptional({ example: '1', description: 'Allow adding records (1 = yes)' })
  @IsString()
  @IsOptional()
  addAccess?: string;

  @ApiPropertyOptional({ example: '1', description: 'Allow editing records (1 = yes)' })
  @IsString()
  @IsOptional()
  editAccess?: string;

  @ApiPropertyOptional({ example: '0', description: 'Allow deleting records (1 = yes)' })
  @IsString()
  @IsOptional()
  deleteAccess?: string;
}

export class SetUserRolesDto {
  @ApiProperty({ type: [UserRoleDto], description: 'Array of role permission assignments' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserRoleDto)
  roles: UserRoleDto[];
}

/** Apply one permission grid to many users at once (User Menu Permission screen). */
export class BatchUserPermissionsDto {
  @ApiProperty({ type: [String], example: ['admin', 'cashier1'], description: 'Target usernames' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  userNames: string[];

  @ApiProperty({ type: [UserRoleDto], description: 'Permission grid applied to every target user' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserRoleDto)
  permissions: UserRoleDto[];
}
