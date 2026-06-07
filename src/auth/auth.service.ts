import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { userName: dto.userName },
      include: { userRoles: true, branch: true },
    });

    if (!user || user.isActive !== 'Y') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password ?? '');
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.validUntil && user.validUntil < new Date()) {
      throw new UnauthorizedException('Account has expired');
    }

    await this.prisma.auditLog.create({
      data: {
        actionPage: 'Login',
        actionDone: 'User logged in',
        userName: user.userName,
        date: new Date(),
        module: 'AUTH',
      },
    });

    const payload = {
      sub: user.id,
      userName: user.userName,
      branchId: user.branchId,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        userName: user.userName,
        name: user.name,
        branchId: user.branchId,
        branchName: user.branch?.branchName,
        permissions: user.userRoles,
      },
    };
  }

  async changePassword(userName: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { userName } });
    if (!user) throw new BadRequestException('User not found');

    const valid = await bcrypt.compare(dto.currentPassword, user.password ?? '');
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { userName },
      data: { password: hashed, lastUpdateDate: new Date(), lastUpdateBy: userName },
    });

    return { message: 'Password changed successfully' };
  }

  async getProfile(userName: string) {
    const user = await this.prisma.user.findUnique({
      where: { userName },
      include: { userRoles: true, branch: true },
    });
    if (!user) return null;
    const { password, ...safeUser } = user;
    return safeUser;
  }
}
