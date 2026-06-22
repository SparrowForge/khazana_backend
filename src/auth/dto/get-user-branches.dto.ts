import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetUserBranchesDto {
  @ApiProperty({ example: 'admin', description: 'Username or email address' })
  @IsString()
  @IsNotEmpty()
  userName: string;
}
