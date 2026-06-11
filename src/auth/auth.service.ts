import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const RESET_CODE_TTL_MS = 10 * 60 * 1000;       // 10 minutes
const RESET_VERIFIED_TTL_MS = 15 * 60 * 1000;   // 15 minutes to complete reset after verify

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}

  // ── Login ─────────────────────────────────────────────────────

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

    // Block login if user has an email but hasn't verified it
    if (user.email && !user.isVerified) {
      throw new UnauthorizedException(
        'Please verify your email address before logging in. Check your inbox or request a new verification link.',
      );
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
        email: user.email,
        isVerified: user.isVerified,
        branchId: user.branchId,
        branchName: user.branch?.branchName,
        permissions: user.userRoles,
      },
    };
  }

  // ── Change Password ───────────────────────────────────────────

  async changePassword(userName: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { userName } });
    if (!user) throw new BadRequestException('User not found');

    const valid = await bcrypt.compare(dto.currentPassword, user.password ?? '');
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const hashed = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { userName },
      data: { password: hashed, lastUpdateDate: new Date(), lastUpdateBy: userName },
    });

    return { message: 'Password changed successfully' };
  }

  // ── Get Profile ───────────────────────────────────────────────

  async getProfile(userName: string) {
    const user = await this.prisma.user.findUnique({
      where: { userName },
      include: { userRoles: true, branch: true },
    });
    if (!user) return null;
    const { password, verificationToken, passwordResetCode, refreshTokenHash, ...safeUser } = user;
    return safeUser;
  }

  // ── Email Verification ────────────────────────────────────────

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.prisma.user.findFirst({
      where: { verificationToken: dto.token },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    if (user.isVerified) {
      return { message: 'Email already verified. You can now log in.' };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verificationToken: null,
        lastUpdateDate: new Date(),
      },
    });

    return { message: 'Email verified successfully. You can now log in.' };
  }

  async resendVerificationEmail(dto: ResendVerificationDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email },
    });

    // Always return success to avoid email enumeration
    if (!user || !user.email) {
      return { message: 'If this email is registered, a verification link has been sent.' };
    }

    if (user.isVerified) {
      return { message: 'This email is already verified. You can log in.' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { verificationToken: token, lastUpdateDate: new Date() },
    });

    await this.mailService.sendVerificationEmail(user.email, token, user.name ?? undefined);
    return { message: 'If this email is registered, a verification link has been sent.' };
  }

  // ── Password Reset Flow ───────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email },
    });

    // Always return success to avoid email enumeration
    if (!user || !user.email) {
      return { message: 'If this email is registered, a reset code has been sent.' };
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiredAt = new Date(Date.now() + RESET_CODE_TTL_MS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetCode: code,
        passwordResetCodeExpiredAt: expiredAt,
        passwordResetVerifiedAt: null,
        lastUpdateDate: new Date(),
      },
    });

    await this.mailService.sendPasswordResetEmail(user.email, code, user.name ?? undefined);
    return { message: 'If this email is registered, a reset code has been sent.' };
  }

  async verifyResetCode(dto: VerifyResetCodeDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email },
    });

    if (!user || !user.passwordResetCode) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    if (user.passwordResetCode !== dto.code) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    if (!user.passwordResetCodeExpiredAt || user.passwordResetCodeExpiredAt < new Date()) {
      throw new BadRequestException('Reset code has expired. Please request a new one.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordResetVerifiedAt: new Date(), lastUpdateDate: new Date() },
    });

    return { message: 'Code verified. You may now reset your password.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email },
    });

    if (!user || !user.passwordResetCode || !user.passwordResetVerifiedAt) {
      throw new BadRequestException('Password reset not authorized. Please restart the flow.');
    }

    // Confirm the code still matches (extra guard)
    if (user.passwordResetCode !== dto.code) {
      throw new BadRequestException('Invalid reset code');
    }

    // verifiedAt must be within the last 15 minutes
    const verifiedAge = Date.now() - user.passwordResetVerifiedAt.getTime();
    if (verifiedAge > RESET_VERIFIED_TTL_MS) {
      throw new BadRequestException('Session expired. Please verify your code again.');
    }

    const hashed = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        passwordResetCode: null,
        passwordResetCodeExpiredAt: null,
        passwordResetVerifiedAt: null,
        lastUpdateDate: new Date(),
      },
    });

    return { message: 'Password reset successfully. You can now log in with your new password.' };
  }

  // ── Helpers ───────────────────────────────────────────────────

  generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
