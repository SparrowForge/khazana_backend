import { IsString, IsNumber, IsPositive, IsOptional, IsDateString, IsUUID, IsArray, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VehicleChallanLineDto {
  @ApiProperty({ format: 'uuid', description: 'Item_Information UUID of the item loaded onto the vehicle' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ example: 25, description: 'Quantity loaded (must be > 0)' })
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

  @ApiPropertyOptional({ example: 'Mirpur-Uttara Route', description: 'Where the van is headed; prints as the "To:" heading' })
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
