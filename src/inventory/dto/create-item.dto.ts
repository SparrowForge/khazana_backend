import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateItemDto {
  @ApiProperty({ example: 'ITM-001', description: 'Unique item code' })
  @IsString()
  @IsNotEmpty()
  itmCode: string;

  @ApiPropertyOptional({ example: 'Kaju Barfi', description: 'Item name' })
  @IsString()
  @IsOptional()
  itmName?: string;

  @ApiPropertyOptional({ example: 'Sweets', description: 'Category name' })
  @IsString()
  @IsOptional()
  itmCategory?: string;

  @ApiPropertyOptional({ example: 'Mithai', description: 'Item type' })
  @IsString()
  @IsOptional()
  itmType?: string;

  @ApiPropertyOptional({ example: 'Pcs', description: 'Unit of measure' })
  @IsString()
  @IsOptional()
  itmUOM?: string;

  @ApiPropertyOptional({ example: 'Premium quality', description: 'Remarks' })
  @IsString()
  @IsOptional()
  itmRemarks?: string;
}

export class UpdateItemDto {
  @ApiPropertyOptional({ example: 'Kaju Barfi Updated' })
  @IsString()
  @IsOptional()
  itmName?: string;

  @ApiPropertyOptional({ example: 'Sweets' })
  @IsString()
  @IsOptional()
  itmCategory?: string;

  @ApiPropertyOptional({ example: 'Mithai' })
  @IsString()
  @IsOptional()
  itmType?: string;

  @ApiPropertyOptional({ example: 'Pcs' })
  @IsString()
  @IsOptional()
  itmUOM?: string;

  @ApiPropertyOptional({ example: 'Y', description: 'Y = active, N = inactive' })
  @IsString()
  @IsOptional()
  isActive?: string;
}
