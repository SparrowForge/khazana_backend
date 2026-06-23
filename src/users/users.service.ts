import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

function stripPassword<T extends {
  password?: string | null;
  verificationToken?: string | null;
  passwordResetCode?: string | null;
  refreshTokenHash?: string | null;
}>(user: T) {
  const { password, verificationToken, passwordResetCode, refreshTokenHash, ...safe } = user;
  return safe;
}

const USER_INCLUDE = {
  branchMappings: { include: { branch: true } },
  userRoles: true,
  profileImage: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const { page, limit } = query;
    const where = { OR: [{ isDeleted: null }, { isDeleted: { not: 'Y' } }] };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: USER_INCLUDE,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { creationDate: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map(stripPassword),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: USER_INCLUDE,
    });
    if (!user) throw new NotFoundException('User not found');
    return stripPassword(user);
  }

  async create(dto: CreateUserDto, createdBy: string) {
    const [existingUser, existingEmail] = await Promise.all([
      this.prisma.user.findUnique({ where: { userName: dto.userName } }),
      dto.email ? this.prisma.user.findFirst({ where: { email: dto.email } }) : null,
    ]);

    if (existingUser) throw new ConflictException('Username already exists');
    if (existingEmail) throw new ConflictException('Email address already in use');

    const [hashed, verificationToken] = await Promise.all([
      bcrypt.hash(dto.password, 12),
      Promise.resolve(crypto.randomBytes(32).toString('hex')),
    ]);

    // Separate branchIds from user fields before spreading
    const { branchIds, password: _pw, mediaFileId, ...userFields } = dto;

    const user = await this.prisma.user.create({
      data: {
        ...userFields,
        password: hashed,
        verificationToken,
        isVerified: false,
        isActive: 'Y',
        creator: createdBy,
        creationDate: new Date(),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        mediaFileId: mediaFileId ?? null,
        branchMappings: {
          create: branchIds.map((branchId) => ({ branchId })),
        },
      },
      include: { profileImage: true },
    });

    if (dto.email) {
      this.mailService
        .sendVerificationEmail(dto.email, verificationToken, dto.name)
        .catch((err) => console.error('Failed to send verification email:', err));
    }

    return stripPassword(user);
  }

  async update(id: string, dto: UpdateUserDto, updatedBy: string) {
    await this.findOne(id);

    // Separate branchIds from user fields — branchIds is not a User column
    const { branchIds, ...userFields } = dto;

    const user = await this.prisma.$transaction(async (tx) => {
      if (branchIds && branchIds.length > 0) {
        // Replace all existing branch assignments atomically
        await tx.userBranchMapping.deleteMany({ where: { userId: id } });
        await tx.userBranchMapping.createMany({
          data: branchIds.map((branchId) => ({ userId: id, branchId })),
        });
      }

      return tx.user.update({
        where: { id },
        data: { ...userFields, lastUpdateBy: updatedBy, lastUpdateDate: new Date() },
        include: { profileImage: true },
      });
    });

    return stripPassword(user);
  }

  async remove(id: string, deletedBy: string) {
    await this.findOne(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { isDeleted: 'Y', deletedBy, deletionDate: new Date() },
    });
    return stripPassword(user);
  }

  async resetPassword(id: string, newPassword: string) {
    await this.findOne(id);
    const hashed = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id }, data: { password: hashed } });
    return { message: 'Password reset successfully' };
  }

  async setUserRoles(userName: string, dto: SetUserRolesDto) {
    await this.prisma.t_UserRole.deleteMany({ where: { userId: userName } });
    await this.prisma.t_UserRole.createMany({
      data: dto.roles.map((r) => ({ userId: userName, ...r })),
    });
    return { message: 'Roles updated' };
  }

  async getUserPermissions(userName: string) {
    const user = await this.prisma.user.findUnique({
      where: { userName },
      select: { id: true, userName: true, name: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const permissions = await this.prisma.t_UserRole.findMany({
      where: { userId: userName },
      orderBy: { controlName: 'asc' },
    });
    return { user, permissions };
  }

  /** Sync/overwrite a user's explicit menu permissions (delete-then-insert). */
  async setUserPermissions(userName: string, dto: SetUserRolesDto) {
    const user = await this.prisma.user.findUnique({
      where: { userName },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.$transaction([
      this.prisma.t_UserRole.deleteMany({ where: { userId: userName } }),
      this.prisma.t_UserRole.createMany({
        data: dto.roles.map((r) => ({ userId: userName, ...r })),
      }),
    ]);
    return { message: 'User permissions updated' };
  }
}
