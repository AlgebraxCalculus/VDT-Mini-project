import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { RoleCode } from '../entities/role.entity';

/** GET /users?role=&q=&page=&size= */
export class QueryUsersDto {
  /** Filter by role code (ADMIN/OPERATOR/VIEWER). */
  @IsOptional()
  @IsEnum(RoleCode)
  role?: RoleCode;

  /** Free-text search across username / email / full name. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size = 20;
}
