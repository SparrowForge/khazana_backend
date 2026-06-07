import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../database/prisma.service';

export interface JwtPayload {
  sub: number;
  userName: string;
  branchId: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'fallback-secret',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { userName: payload.userName },
      include: { userRoles: true },
    });

    if (!user || user.isActive !== 'Y') {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      id: user.id,
      userName: user.userName,
      name: user.name,
      branchId: user.branchId,
      userRoles: user.userRoles,
    };
  }
}
