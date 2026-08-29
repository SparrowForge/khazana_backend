import { IsString, IsNumber, IsPositive, IsOptional, IsDateString, IsUUID, IsArray, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DateRangeQueryDto } from '../../common/dto';

export class VehicleChallanLineDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Item_Information UUID when the line was picked from the catalogue. Omit for an ad-hoc line — goods typed straight onto the challan are NOT added to the Item table.',
  })
  @IsUUID()
  @IsOptional()
  itemId?: string;

  @ApiPropertyOptional({
    example: 'Soan Papri 200gm',
    description: 'Printed description. Required when there is no itemId; sent for catalogue lines too, and stored as the line snapshot.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  itemName?: string;

  @ApiPropertyOptional({ example: 'Pcs', description: 'Unit printed in the UOM column' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  uom?: string;

  @ApiProperty({ example: 25, description: 'Quantity (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;
}

/** The vehicle/route header shared by create and update. No receiving branch —
 *  that is the whole point of the document. */
class VehicleChallanHeaderDto {
  @ApiProperty({ example: '2026-08-27', description: 'Challan date (ISO 8601)' })
  @IsDateString()
  challanDate: string;

  @ApiPropertyOptional({ example: 'Mr. Kabir', description: 'Who the challan is made out to. Typed by hand — no Customer record is required.' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  customerName?: string;

  @ApiPropertyOptional({ example: 'Dhaka' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  customerAddress?: string;

  @ApiPropertyOptional({ example: 'Gazipur', description: 'Where the goods are being delivered' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  deliveryAddress?: string;

  @ApiPropertyOptional({ example: 'Mr. Rahman', description: 'Who to ask for on delivery' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  contactPerson?: string;

  @ApiPropertyOptional({ example: '01711-000000', description: "The contact person's number" })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  contactNo?: string;

  @ApiPropertyOptional({ example: 'PO-4471', description: 'Customer purchase order the goods go against' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  poNo?: string;

  @ApiPropertyOptional({ example: '2026-08-20', description: 'Date of that purchase order (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  poDate?: string;

  @ApiPropertyOptional({ example: 'Mirpur-Uttara Route', description: 'Where the van is headed' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  route?: string;

  @ApiPropertyOptional({
    example: 'DHAKA METRO-TA-11-2233',
    description: 'Registration of the vehicle leaving the factory. Optional — a challan can be raised before the van is assigned.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  vehicleNo?: string;

  @ApiPropertyOptional({ example: 'Abdul Karim' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  driverName?: string;

  @ApiPropertyOptional({ example: '01711-000000' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  driverMobile?: string;

  @ApiPropertyOptional({ example: 'CH-0012', description: 'Manual voucher number; prints as the challan number when set' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  voucherNo?: string;

  @ApiPropertyOptional({ example: 'Morning trip', description: 'Free-text note stored on every line of this challan' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remarks?: string;
}

export class CreateVehicleChallanDto extends VehicleChallanHeaderDto {
  @ApiPropertyOptional({ example: 'VCH-FAC-202608-00001', description: 'Serial number; generated when omitted' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  serialNo?: string;

  @ApiProperty({ type: [VehicleChallanLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VehicleChallanLineDto)
  items: VehicleChallanLineDto[];
}

export class UpdateVehicleChallanDto extends VehicleChallanHeaderDto {
  @ApiProperty({ type: [VehicleChallanLineDto], description: 'Full replacement set of lines for this serial number' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VehicleChallanLineDto)
  items: VehicleChallanLineDto[];
}

/** List query for the Challan Entry landing page.
 *
 *  Kept local to this module rather than added to the shared DateRangeQueryDto:
 *  the customer name is typed by hand onto the challan, so no other list has
 *  the column to filter on. The global ValidationPipe runs with
 *  `forbidNonWhitelisted`, so the param has to be declared somewhere or the
 *  request 400s. */
export class VehicleChallanQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    example: 'Kabir',
    description: 'Partial, case-insensitive match on the customer the challan was made out to',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  customerName?: string;
}
