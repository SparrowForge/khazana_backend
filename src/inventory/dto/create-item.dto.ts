import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
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

  @ApiPropertyOptional({ example: 'FG', description: 'Item type: RW | FG | SFG | P' })
  @IsString()
  @IsOptional()
  itmType?: string;

  @ApiPropertyOptional({ example: 'KG', description: 'Unit of measure: Pcs | Cup | gm | KG | LT | ml' })
  @IsString()
  @IsOptional()
  itmUOM?: string;

  @ApiPropertyOptional({ example: 'Premium quality', description: 'Remarks (max 500 chars)' })
  @IsString()
  @IsOptional()
  itmRemarks?: string;

  @ApiPropertyOptional({
    example: '2d642193-e643-4b35-9951-c983c39f5bb2',
    description: 'UUID of the media_files record returned by POST /upload',
  })
  @IsUUID('4')
  @IsOptional()
  imageId?: string;

  @ApiPropertyOptional({ example: 'Y', description: 'Y = active, N = inactive' })
  @IsString()
  @IsOptional()
  isActive?: string;
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

  @ApiPropertyOptional({ example: 'FG' })
  @IsString()
  @IsOptional()
  itmType?: string;

  @ApiPropertyOptional({ example: 'KG' })
  @IsString()
  @IsOptional()
  itmUOM?: string;

  @ApiPropertyOptional({ example: 'Premium quality' })
  @IsString()
  @IsOptional()
  itmRemarks?: string;

  @ApiPropertyOptional({
    example: '2d642193-e643-4b35-9951-c983c39f5bb2',
    description: 'UUID of the media_files record; set to null to remove image',
  })
  @IsUUID('4')
  @IsOptional()
  imageId?: string;

  @ApiPropertyOptional({ example: 'Y', description: 'Y = active, N = inactive' })
  @IsString()
  @IsOptional()
  isActive?: string;
}
