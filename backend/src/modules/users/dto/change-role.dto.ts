import { IsInt } from 'class-validator';

/** PUT /users/{id}/role */
export class ChangeRoleDto {
  @IsInt()
  roleId: number;
}
