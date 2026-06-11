import { Controller, Post, Get, Body, UseGuards, Request, Patch } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // ── Core Auth ─────────────────────────────────────────────────

  @Post('login')
  @ApiOperation({ summary: 'Login and receive JWT token' })
  @ApiResponse({ status: 200, description: 'Returns access token and user profile' })
  @ApiResponse({ status: 401, description: 'Invalid credentials or email not verified' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Returns authenticated user profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.userName);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Change password for current user' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Current password is incorrect' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  changePassword(@Request() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.userName, dto);
  }

  // ── Email Verification ────────────────────────────────────────

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email address using token from link' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('resend-verification-email')
  @ApiOperation({ summary: 'Resend email verification link' })
  @ApiResponse({ status: 200, description: 'Verification link sent if email is registered' })
  resendVerificationEmail(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto);
  }

  @Post('send-verification-email')
  @ApiOperation({ summary: 'Send verification email (admin / manual trigger)' })
  @ApiResponse({ status: 200, description: 'Verification link sent if email is registered' })
  sendVerificationEmail(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto);
  }

  // ── Password Reset ────────────────────────────────────────────

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a 6-digit password reset code by email' })
  @ApiResponse({ status: 200, description: 'Reset code sent if email is registered' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('verify-reset-code')
  @ApiOperation({ summary: 'Validate 6-digit reset code from email' })
  @ApiResponse({ status: 200, description: 'Code verified — proceed to reset password' })
  @ApiResponse({ status: 400, description: 'Invalid or expired code' })
  verifyResetCode(@Body() dto: VerifyResetCodeDto) {
    return this.authService.verifyResetCode(dto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Set a new password after code verification' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid code, expired session, or weak password' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
