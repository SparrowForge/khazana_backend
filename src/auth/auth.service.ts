import { Injectable, UnauthorizedException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto, GoogleCredentialDto } from './dto/google-login.dto';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
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
    const isEmail = dto.userName.includes('@');
    const user = isEmail
      ? await this.prisma.user.findFirst({
          where: { email: dto.userName },
          include: { userRoles: true, branchMappings: { include: { branch: true } } },
        })
      : await this.prisma.user.findUnique({
          where: { userName: dto.userName },
          include: { userRoles: true, branchMappings: { include: { branch: true } } },
        });

    if (!user || user.isActive !== 'Y') {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify the selected branch is among the user's assigned branches
    const branchMapping = user.branchMappings.find((m) => m.branchId === dto.branchId);
    if (!branchMapping) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password ?? '');
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.validUntil && user.validUntil < new Date()) {
      throw new UnauthorizedException('Account has expired');
    }

    if (!user.isVerified) {
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

    const payload = { sub: user.id, userName: user.userName, branchId: dto.branchId };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        userName: user.userName,
        userPrefix: user.userPrefix,
        name: user.name,
        email: user.email,
        isVerified: user.isVerified,
        branchId: dto.branchId,
        branchName: branchMapping.branch.branchName,
        // Branch-scoped features (e.g. Production Entry, factory-only) key off
        // the code as well as the name, so the name can be edited freely.
        branchCode: branchMapping.branch.branchCode,
        permissions: user.userRoles,
      },
    };
  }

  // ── Google Sign-In ─────────────────────────────────────────────
  //
  // Google is an IDENTITY provider here, not an account source: it proves who
  // the person is, and that identity is then matched to an existing User by
  // email. Signing in with a Google account nobody has been given does NOT
  // create one — self-provisioning into an ERP would be a hole, not a feature.

  /** Lazily built so the app still boots without Google configured; the error
   *  only surfaces on an actual Google sign-in attempt. */
  private googleClient?: OAuth2Client;

  private getGoogleClient(): OAuth2Client {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured on this server (GOOGLE_CLIENT_ID is not set)',
      );
    }
    if (!this.googleClient) this.googleClient = new OAuth2Client(clientId);
    return this.googleClient;
  }

  /**
   * Verify the ID token and return its payload.
   *
   * `verifyIdToken` checks the signature against Google's rotating public keys,
   * the expiry, the issuer AND the audience — the audience check is what stops a
   * token minted for some other site being replayed here, so `audience` must
   * always be passed.
   */
  private async verifyGoogleToken(credential: string): Promise<TokenPayload> {
    // Resolved BEFORE the try: a server with no GOOGLE_CLIENT_ID must surface as
    // 503 "not configured", not be swallowed by the catch below and reported as
    // a bad token — that would send an operator hunting for a client-side fault.
    const client = this.getGoogleClient();
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    let ticket;
    try {
      ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    } catch {
      // Deliberately vague: a caller probing with forged tokens learns nothing.
      throw new UnauthorizedException('Google sign-in failed');
    }
    const payload = ticket.getPayload();
    if (!payload?.email) throw new UnauthorizedException('Google sign-in failed');
    // An unverified Google address proves nothing about who owns it.
    if (!payload.email_verified) {
      throw new UnauthorizedException('This Google account has no verified email address');
    }
    return payload;
  }

  /** Match a verified Google identity to a local user. Email is the only link —
   *  there is no Google id column — so an account with no email can never sign
   *  in this way. */
  private async userForGoogleEmail(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { userRoles: true, branchMappings: { include: { branch: true } } },
    });
    if (!user || user.isActive !== 'Y') {
      throw new UnauthorizedException('No active account is linked to this Google address');
    }
    if (user.validUntil && user.validUntil < new Date()) {
      throw new UnauthorizedException('Account has expired');
    }
    return user;
  }

  /** Step 1 — which branches this Google identity may sign in at. Mirrors the
   *  username-driven `getUserBranches`, so the UI flow is the same either way. */
  async googleBranches(dto: GoogleCredentialDto) {
    const payload = await this.verifyGoogleToken(dto.credential);
    const user = await this.userForGoogleEmail(payload.email!);
    return {
      email: user.email,
      name: user.name ?? payload.name ?? null,
      branches: user.branchMappings.map((m) => ({
        id: m.branch.id,
        branchCode: m.branch.branchCode,
        branchName: m.branch.branchName,
      })),
    };
  }

  /** Step 2 — issue our own session token. `branchId` may be omitted when the
   *  account maps to exactly one branch, which is the common case. */
  async googleLogin(dto: GoogleLoginDto) {
    const payload = await this.verifyGoogleToken(dto.credential);
    const user = await this.userForGoogleEmail(payload.email!);

    const mapping = dto.branchId
      ? user.branchMappings.find((m) => m.branchId === dto.branchId)
      : user.branchMappings.length === 1
        ? user.branchMappings[0]
        : undefined;
    if (!mapping) {
      throw new UnauthorizedException(
        user.branchMappings.length
          ? 'Select a branch to sign in at'
          : 'No branch is assigned to this account',
      );
    }

    await this.prisma.auditLog.create({
      data: {
        actionPage: 'Login',
        // Recorded distinctly so the audit trail shows HOW the session started.
        actionDone: 'User logged in via Google',
        userName: user.userName,
        date: new Date(),
        module: 'AUTH',
      },
    });

    const jwt = { sub: user.id, userName: user.userName, branchId: mapping.branchId };
    return {
      accessToken: this.jwtService.sign(jwt),
      user: {
        id: user.id,
        userName: user.userName,
        userPrefix: user.userPrefix,
        name: user.name,
        email: user.email,
        isVerified: user.isVerified,
        branchId: mapping.branchId,
        branchName: mapping.branch.branchName,
        branchCode: mapping.branch.branchCode,
        permissions: user.userRoles,
      },
    };
  }

  // ── Get User Branches (pre-login branch selector) ──────────────

  async getUserBranches(userName: string) {
    if (!userName) return { branches: [] };

    const isEmail = userName.includes('@');
    const user = isEmail
      ? await this.prisma.user.findFirst({
          where: { email: userName },
          include: { branchMappings: { include: { branch: true } } },
        })
      : await this.prisma.user.findUnique({
          where: { userName },
          include: { branchMappings: { include: { branch: true } } },
        });

    if (!user || user.isActive !== 'Y') {
      return { branches: [] };
    }

    return {
      branches: user.branchMappings.map((m) => ({
        id: m.branch.id,
        branchCode: m.branch.branchCode,
        branchName: m.branch.branchName,
      })),
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
      include: { userRoles: true, branchMappings: { include: { branch: true } } },
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
