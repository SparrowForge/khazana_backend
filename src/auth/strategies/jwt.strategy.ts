import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../database/prisma.service';

export interface JwtPayload {
  sub: string;
  userName: string;
  branchId: string;
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
      include: { userRoles: true, branchMappings: { select: { branchId: true } } },
    });

    if (!user || user.isActive !== 'Y') {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Every branch this user may see, from user_to_branch_mapping. Data access
    // is scoped to this set, NOT to `branchId` — that is only the branch picked
    // at login, and a user assigned to two branches must still see both.
    //
    // Resolved per request rather than carried in the token so revoking a branch
    // takes effect immediately instead of at the next login, and so tokens
    // issued before this existed keep working.
    const mapped = user.branchMappings.map((m) => m.branchId);
    // A user with no mapping falls back to their session branch: better than
    // locking them out of every screen, and it keeps behaviour sane for any
    // account created before mappings were populated.
    const branchIds = mapped.length ? mapped : [payload.branchId].filter(Boolean);

    return {
      id: user.id,
      userName: user.userName,
      name: user.name,
      branchId: payload.branchId,
      branchIds,
      userRoles: user.userRoles,
    };
  }
}
