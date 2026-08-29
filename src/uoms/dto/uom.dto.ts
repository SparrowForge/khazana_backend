import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUomDto {
  @ApiProperty({
    example: 'Box',
    description:
      'The unit as it is written onto an item (Item_Information.itmUOM) and printed on documents. Unique.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code: string;

  @ApiPropertyOptional({ example: 'Box', description: 'Spelled-out name, shown only on this screen' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: 'Cartons of 12' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  remarks?: string;
}

/** `code` is deliberately absent: it is the value already stored on every item
 *  that uses this unit, and nothing rewrites those rows, so editing it would
 *  orphan them. A mistyped code is deleted and re-added. */
export class UpdateUomDto {
  @ApiPropertyOptional({ example: 'Box' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: 'Cartons of 12' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  remarks?: string;
}
