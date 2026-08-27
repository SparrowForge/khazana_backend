import {
  IsString, IsNumber, IsPositive, IsOptional, IsDateString,
  IsArray, ValidateNested, MaxLength, IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BranchPaginationQueryDto } from '../../common/dto';

/** One packet line of a receive or issue document. */
export class PacketLineDto {
  @ApiProperty({ example: 'P001', description: 'PacketInfo.code of the packet' })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty({ example: 25, description: 'Quantity (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;
}

export class CreatePacketReceiveDto {
  @ApiPropertyOptional({ example: 'PKR-FAC-202608-00001', description: 'Serial number; generated when omitted' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  serialNo?: string;

  @ApiPropertyOptional({ example: 'VCH-1043', description: 'Supplier voucher / challan number' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  voucharNo?: string;

  @ApiProperty({ example: '2026-08-27', description: 'Receive date (ISO 8601)' })
  @IsDateString()
  receiveDate: string;

  @ApiProperty({ type: [PacketLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PacketLineDto)
  items: PacketLineDto[];
}

export class UpdatePacketReceiveDto {
  @ApiPropertyOptional({ example: 'VCH-1043' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  voucharNo?: string;

  @ApiProperty({ example: '2026-08-27' })
  @IsDateString()
  receiveDate: string;

  @ApiProperty({ type: [PacketLineDto], description: 'Full replacement set of lines for this serial number' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PacketLineDto)
  items: PacketLineDto[];
}

export class CreatePacketIssueDto {
  @ApiPropertyOptional({ example: 'PKI-FAC-202608-00001', description: 'Serial number; generated when omitted' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  serialNo?: string;

  @ApiPropertyOptional({ example: 'INV-2201', description: 'Related sale invoice number, when the issue backs one' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  invoiceNo?: string;

  @ApiPropertyOptional({ example: 'Sale', description: 'Sale | Internal | Damaged' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  issueType?: string;

  @ApiProperty({ example: '2026-08-27', description: 'Issue date (ISO 8601)' })
  @IsDateString()
  issueDate: string;

  @ApiProperty({ type: [PacketLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PacketLineDto)
  items: PacketLineDto[];
}

export class UpdatePacketIssueDto {
  @ApiPropertyOptional({ example: 'INV-2201' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  invoiceNo?: string;

  @ApiPropertyOptional({ example: 'Sale' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  issueType?: string;

  @ApiProperty({ example: '2026-08-27' })
  @IsDateString()
  issueDate: string;

  @ApiProperty({ type: [PacketLineDto], description: 'Full replacement set of lines for this serial number' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PacketLineDto)
  items: PacketLineDto[];
}

/**
 * Packet Stock query — a branch and a date window.
 *
 * The window splits the movement in two: everything strictly BEFORE `fromDate`
 * becomes the opening balance, everything inside `[fromDate, toDate]` becomes
 * the received/issued columns. Omitting `fromDate` therefore means "no opening
 * period" — opening reads 0 and every movement lands in the columns.
 *
 * `page`/`limit` are inherited but unused: the sheet is a stock register and is
 * returned whole so its column totals are the real totals.
 */
export class PacketStockQueryDto extends BranchPaginationQueryDto {
  @ApiPropertyOptional({ example: 'P001', description: 'Restrict to a single packet code' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Period start (inclusive). Movement before this date is the opening balance.' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Period end (inclusive)' })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ description: 'Set 1 to list every active packet, including those with no movement and no balance' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  includeEmpty?: number;
}
