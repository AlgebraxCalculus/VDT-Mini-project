import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { RoleCode } from './entities/role.entity';
import { UsersService } from './users.service';

/**
 * Group B — Account management & RBAC. The whole controller is Admin-only:
 * @Roles(ADMIN) at class level is enforced by the global RolesGuard. The
 * self-demotion / last-admin business rules live in UsersService.
 */
@Controller()
@Roles(RoleCode.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** API 11 — GET /roles. (Declared before /users/:id-style routes for clarity.) */
  @Get('roles')
  listRoles() {
    return this.usersService.listRoles();
  }

  /** API 5 — GET /users. */
  @Get('users')
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  /** API 6 — GET /users/{id}. */
  @Get('users/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  /** API 7 — POST /users. */
  @Post('users')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  /** API 8 — PATCH /users/{id}. */
  @Patch('users/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.usersService.update(id, dto, currentUser);
  }

  /** API 9 — DELETE /users/{id}. */
  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.usersService.remove(id, currentUser);
  }

  /** API 10 — PUT /users/{id}/role. */
  @Put('users/:id/role')
  changeRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeRoleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.usersService.changeRole(id, dto.roleId, currentUser);
  }
}
