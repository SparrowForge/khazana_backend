import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto';

/** Query for the paginated customer list behind the Customers page. */
export class CustomerListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter on customer code, name or contact no (case-insensitive, contains). Applied before paging, so the search covers every customer on file and not just the page on screen.',
    example: '01711',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
