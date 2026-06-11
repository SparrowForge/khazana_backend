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

function stripPassword<T extends { password?: string | null; verificationToken?: string | null; passwordResetCode?: string | null; refreshTokenHash?: string | null }>(user: T) {
  const { password, verificationToken, passwordResetCode, refreshTokenHash, ...safe } = user;
  return safe;
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const { page, limit } = query;
    const where = { isDeleted: { not: 'Y' as const } };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { branch: true, userRoles: true },
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
      include: { branch: true, userRoles: true },
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

    const user = await this.prisma.user.create({
      data: {
        ...dto,
        password: hashed,
        email: dto.email,
        verificationToken,
        isVerified: false,
        isActive: 'Y',
        creator: createdBy,
        creationDate: new Date(),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });

    // Send verification email (fire-and-forget — don't block user creation on mail failure)
    if (dto.email) {
      this.mailService
        .sendVerificationEmail(dto.email, verificationToken, dto.name)
        .catch((err) => console.error('Failed to send verification email:', err));
    }

    return stripPassword(user);
  }

  async update(id: string, dto: UpdateUserDto, updatedBy: string) {
    await this.findOne(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...dto, lastUpdateBy: updatedBy, lastUpdateDate: new Date() },
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
}
