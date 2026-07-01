import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Brackets, Repository } from 'typeorm';
import { TokenStoreService } from '../auth/token-store.service';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role, RoleCode } from './entities/role.entity';
import { User } from './entities/user.entity';

/** User row with the password hash stripped — the only shape returned to clients. */
export type PublicUser = Omit<User, 'passwordHash'>;

export interface PaginatedUsers {
  data: PublicUser[];
  total: number;
  page: number;
  size: number;
}

@Injectable()
export class UsersService {
  private readonly saltRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Role)
    private readonly rolesRepo: Repository<Role>,
    private readonly config: ConfigService,
    private readonly tokenStore: TokenStoreService,
  ) {
    this.saltRounds = parseInt(
      this.config.get<string>('BCRYPT_SALT_ROUNDS') ?? '12',
      10,
    );
  }

  // --- Internal helpers for AuthService (these keep the hash) ---

  /** Load a user (with role + passwordHash) for credential verification. */
  findByUsernameWithSecret(username: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { username },
      relations: { role: true },
    });
  }

  /** Load a user (with role) by id — used when minting refreshed tokens. */
  findEntityById(id: number): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { id },
      relations: { role: true },
    });
  }

  /** Stamp last_login_at after a successful login. */
  async touchLastLogin(id: number): Promise<void> {
    await this.usersRepo.update(id, { lastLoginAt: new Date() });
  }

  // --- Group B — Account management (Admin) ---

  /** GET /users — filter by role/text, paginated. */
  async findAll(query: QueryUsersDto): Promise<PaginatedUsers> {
    const { role, q, page, size } = query;

    const qb = this.usersRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * size)
      .take(size);

    if (role) {
      qb.andWhere('role.code = :role', { role });
    }

    if (q) {
      // Case-insensitive search across username/email/fullName.
      qb.andWhere(
        new Brackets((w) => {
          w.where('user.username ILIKE :q', { q: `%${q}%` })
            .orWhere('user.email ILIKE :q', { q: `%${q}%` })
            .orWhere('user.fullName ILIKE :q', { q: `%${q}%` });
        }),
      );
    }

    const [rows, total] = await qb.getManyAndCount();
    return {
      data: rows.map((u) => this.toPublic(u)),
      total,
      page,
      size,
    };
  }

  /** GET /users/{id}. */
  async findOne(id: number): Promise<PublicUser> {
    const user = await this.findEntityById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return this.toPublic(user);
  }

  /** POST /users — bcrypt-hash the password. */
  async create(dto: CreateUserDto): Promise<PublicUser> {
    await this.assertRoleExists(dto.roleId);

    // Pre-check username/email uniqueness for a clean 409.
    const clash = await this.usersRepo.findOne({
      where: [{ username: dto.username }, { email: dto.email }],
    });
    if (clash) {
      throw new ConflictException('username or email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    const user = this.usersRepo.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
      fullName: dto.fullName ?? null,
      roleId: dto.roleId,
      isActive: true,
    });

    const saved = await this.usersRepo.save(user);
    return this.findOne(saved.id);
  }

  /**
   * PATCH /users/{id}. Business rules: no self role-change, and the last active
   * ADMIN can't be demoted or deactivated.
   */
  async update(
    id: number,
    dto: UpdateUserDto,
    currentUser: AuthenticatedUser,
  ): Promise<PublicUser> {
    const user = await this.findEntityById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    const isSelf = currentUser.id === id;
    const roleChanged = dto.roleId !== undefined && dto.roleId !== user.roleId;
    const deactivating = dto.isActive === false && user.isActive;

    // No self role-change or self-deactivation.
    if (isSelf && roleChanged) {
      throw new ForbiddenException('You cannot change your own role');
    }
    if (isSelf && deactivating) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

    // Protect the last admin from demotion or deactivation.
    if (this.isAdmin(user) && (deactivating || (roleChanged && dto.roleId))) {
      if (roleChanged && dto.roleId) {
        const target = await this.rolesRepo.findOne({
          where: { id: dto.roleId },
        });
        if (!target) throw new BadRequestException('Target role does not exist');
        if (target.code !== RoleCode.ADMIN) {
          await this.assertNotLastAdmin(id);
        }
      } else if (deactivating) {
        await this.assertNotLastAdmin(id);
      }
    }

    if (dto.email !== undefined) user.email = dto.email;
    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.password !== undefined) {
      user.passwordHash = await bcrypt.hash(dto.password, this.saltRounds);
    }
    if (roleChanged && dto.roleId) {
      await this.assertRoleExists(dto.roleId);
      user.roleId = dto.roleId;
    }

    try {
      await this.usersRepo.save(user);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('email already in use');
      }
      throw err;
    }

    // A role change must invalidate the user's live tokens.
    if (roleChanged) {
      await this.tokenStore.invalidateUser(id);
    }

    return this.findOne(id);
  }

  /** PUT /users/{id}/role — same guards as update() plus mandatory token invalidation. */
  async changeRole(
    id: number,
    roleId: number,
    currentUser: AuthenticatedUser,
  ): Promise<PublicUser> {
    if (currentUser.id === id) {
      throw new ForbiddenException('You cannot change your own role');
    }

    const user = await this.findEntityById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    const target = await this.rolesRepo.findOne({ where: { id: roleId } });
    if (!target) {
      throw new BadRequestException('Target role does not exist');
    }

    if (this.isAdmin(user) && target.code !== RoleCode.ADMIN) {
      await this.assertNotLastAdmin(id);
    }

    if (user.roleId !== roleId) {
      user.roleId = roleId;
      await this.usersRepo.save(user);
      // Revoke tokens so the new role takes effect now.
      await this.tokenStore.invalidateUser(id);
    }

    return this.findOne(id);
  }

  /** DELETE /users/{id} — block deleting the last active admin. */
  async remove(id: number, currentUser: AuthenticatedUser): Promise<void> {
    const user = await this.findEntityById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    if (currentUser.id === id) {
      throw new ForbiddenException('You cannot delete your own account');
    }

    if (this.isAdmin(user)) {
      await this.assertNotLastAdmin(id);
    }

    await this.usersRepo.delete(id);
    await this.tokenStore.invalidateUser(id);
  }

  /** API 11 — GET /roles. RBAC catalog for the "assign role" form. */
  listRoles(): Promise<Role[]> {
    return this.rolesRepo.find({ order: { id: 'ASC' } });
  }

  // --- Guards / mappers ---

  private isAdmin(user: User): boolean {
    return user.role?.code === RoleCode.ADMIN;
  }

  /** Throws if `excludingId` is the only remaining active ADMIN. */
  private async assertNotLastAdmin(excludingId: number): Promise<void> {
    const activeAdmins = await this.usersRepo
      .createQueryBuilder('user')
      .innerJoin('user.role', 'role')
      .where('role.code = :code', { code: RoleCode.ADMIN })
      .andWhere('user.isActive = true')
      .andWhere('user.id != :excludingId', { excludingId })
      .getCount();

    if (activeAdmins === 0) {
      throw new ForbiddenException(
        'Operation denied: cannot remove the last active ADMIN',
      );
    }
  }

  private async assertRoleExists(roleId: number): Promise<void> {
    const exists = await this.rolesRepo.exists({ where: { id: roleId } });
    if (!exists) {
      throw new BadRequestException(`Role ${roleId} does not exist`);
    }
  }

  /** Strip the password hash before anything leaves the service. */
  private toPublic(user: User): PublicUser {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
