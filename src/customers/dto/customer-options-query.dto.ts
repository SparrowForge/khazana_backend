import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query for GET /customers/options — the customer picker every entry screen
 * shows (POS, credit sale, order, NC, money receipt, the report filters).
 *
 * Deliberately not a `PaginationQueryDto`: that caps `limit` at 100, so a
 * picker built on it could only ever offer the first hundred customers by
 * name. A shop with more than that could not bill the rest at all — the row
 * simply wasn't in the list. This is a flat, un-paginated list instead.
 */
export class CustomerOptionsQueryDto {
  @ApiPropertyOptional({
    description:
      'Type-ahead filter on customer code, name or contact no (case-insensitive, contains). Lets the picker fetch the matches for what was typed rather than the whole customer book.',
    example: '01711',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    default: 500,
    minimum: 1,
    maximum: 1000,
    description: 'Most rows to return, ordered by name.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit: number = 500;
}
