import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto';

export class PriceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by item code' })
  @IsOptional()
  @IsString()
  itemCode?: string;
}
