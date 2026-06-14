import { IsString, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePosProductDto {
  @ApiProperty({ example: 'Gulab Jamun', description: 'Product name' })
  @IsString()
  name: string;

  @ApiProperty({ example: 150.00, description: 'Unit price (BDT)' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 15, description: 'VAT percentage (0–100)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  vatPercentage?: number;

  @ApiPropertyOptional({ example: true, description: 'Whether product is active' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
