import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Date-range filter for the POS Sales list. Unpaginated (the screen renders
 *  the whole range so it can be printed/exported in one go). */
export class PosSalesQueryDto {
  @ApiPropertyOptional({ format: 'date', description: 'Range start (inclusive), YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Range end (inclusive), YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}
