import { IsString, IsNumber, IsPositive, IsOptional, IsDateString, IsUUID, IsArray, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductionLineDto {
  @ApiProperty({ format: 'uuid', description: 'Item_Information UUID of the produced item' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ example: 25, description: 'Quantity produced (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;

  @ApiPropertyOptional({
    example: 138.0,
    description: 'Unit rate INCLUSIVE of VAT (list price + VAT), unlike Item_Issue.unitPrice',
  })
  @IsNumber()
  @IsOptional()
  rate?: number;
}

export class CreateProductionDto {
  @ApiPropertyOptional({ example: 'PRD-FAC-202608-00001', description: 'Serial number; generated when omitted' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  serialNo?: string;

  @ApiProperty({ example: '2026-08-18', description: 'Production date (ISO 8601)' })
  @IsDateString()
  productionDate: string;

  @ApiPropertyOptional({ example: 'Morning batch', description: 'Free-text note stored on every line of this entry' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remarks?: string;

  @ApiProperty({ type: [ProductionLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionLineDto)
  items: ProductionLineDto[];
}

export class UpdateProductionDto {
  @ApiProperty({ example: '2026-08-18', description: 'Production date (ISO 8601)' })
  @IsDateString()
  productionDate: string;

  @ApiPropertyOptional({ example: 'Morning batch' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remarks?: string;

  @ApiProperty({ type: [ProductionLineDto], description: 'Full replacement set of lines for this serial number' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionLineDto)
  items: ProductionLineDto[];
}
