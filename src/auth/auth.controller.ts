import { Controller, Post, Get, Body, UseGuards, Request, Patch, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { GoogleLoginDto, GoogleCredentialDto } from './dto/google-login.dto';
import { JwtAuthGuard } from './guards/jwt.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // ── Core Auth ─────────────────────────────────────────────────

  @Get('user-branches')
  @ApiOperation({ summary: 'Get branches assigned to a user — called before login to populate the branch selector' })
  @ApiQuery({ name: 'userName', description: 'Username or email address', example: 'admin' })
  @ApiResponse({ status: 200, description: 'List of branches the user is assigned to (empty array if user not found)' })
  getUserBranches(@Query('userName') userName: string) {
    return this.authService.getUserBranches(userName ?? '');
  }

  @Post('login')
  @ApiOperation({ summary: 'Login and receive JWT token' })
  @ApiResponse({ status: 200, description: 'Returns access token and user profile' })
  @ApiResponse({ status: 401, description: 'Invalid credentials or email not verified' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('google/branches')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Branches a Google identity may sign in at',
    description: 'Verifies the Google ID token and returns the branches mapped to the matching account.',
  })
  @ApiResponse({ status: 200, description: 'Matching account and its branches' })
  @ApiResponse({ status: 401, description: 'Invalid token, or no active account linked to that address' })
  @ApiResponse({ status: 503, description: 'Google sign-in is not configured on this server' })
  googleBranches(@Body() dto: GoogleCredentialDto) {
    return this.authService.googleBranches(dto);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with Google',
    description:
      'Verifies the Google ID token server-side and issues a session token. '
      + 'Does NOT create accounts — the Google address must already belong to an active user.',
  })
  @ApiResponse({ status: 200, description: 'Signed in' })
  @ApiResponse({ status: 401, description: 'Invalid token, unknown address, or no branch selected' })
  @ApiResponse({ status: 503, description: 'Google sign-in is not configured on this server' })
  googleLogin(@Body() dto: GoogleLoginDto) {
    return this.authService.googleLogin(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-branches')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Branches the signed-in user may see',
    description:
      'The branch set of the signed-in user, for the branch pickers on reports and entry screens. '
      + 'Unlike GET /admin/branches this never lists a branch the user is not mapped to.',
  })
  @ApiResponse({ status: 200, description: 'Branches the caller is mapped to, in display order' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getMyBranches(@CurrentUser('branchIds') branchIds: string[]) {
    return this.authService.getBranchesByIds(branchIds);
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
