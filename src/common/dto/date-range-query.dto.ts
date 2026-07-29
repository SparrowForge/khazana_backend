import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BranchPaginationQueryDto } from './branch-pagination-query.dto';

/**
 * Paginated list query with a branch filter and an inclusive date range.
 * The global ValidationPipe runs with `forbidNonWhitelisted`, so any endpoint
 * whose UI sends fromDate/toDate must declare them here or the request 400s.
 */
export class DateRangeQueryDto extends BranchPaginationQueryDto {
  @ApiPropertyOptional({ format: 'date', description: 'Range start (inclusive), YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Range end (inclusive), YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}

/** Prisma `{ gte, lte }` filter for an inclusive day range, or undefined when
 *  neither bound was supplied. Bounds are built the same way ReportsService's
 *  `parseRange` builds them — end-of-day on `toDate` — so a list and the report
 *  covering the same range agree on which rows fall inside it. Invalid dates are
 *  ignored rather than reaching Prisma as `Invalid Date` (an opaque 500). */
export function dateRangeFilter(fromDate?: string, toDate?: string) {
  const range: { gte?: Date; lte?: Date } = {};
  if (fromDate) {
    const from = new Date(fromDate);
    if (!isNaN(from.getTime())) range.gte = from;
  }
  if (toDate) {
    const to = new Date(toDate);
    if (!isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999); // inclusive of the whole end day
      range.lte = to;
    }
  }
  return range.gte || range.lte ? range : undefined;
}
