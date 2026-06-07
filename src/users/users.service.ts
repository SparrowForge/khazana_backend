import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';

function stripPassword<T extends { password?: string | null }>(user: T) {
  const { password, ...safe } = user;
  return safe;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      where: { isDeleted: { not: 'Y' } },
      include: { branch: true, userRoles: true },
    });
    return users.map(stripPassword);
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
    const existing = await this.prisma.user.findUnique({ where: { userName: dto.userName } });
    if (existing) throw new ConflictException('Username already exists');

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        ...dto,
        password: hashed,
        isActive: 'Y',
        creator: createdBy,
        creationDate: new Date(),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });
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
    const hashed = await bcrypt.hash(newPassword, 10);
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
