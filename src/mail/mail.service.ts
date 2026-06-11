import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendVerificationEmail(email: string, token: string, name = 'User'): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const verifyUrl = `${frontendUrl}/verify?token=${token}`;

    await this.transporter.sendMail({
      from: `"${process.env.FROM_NAME ?? 'Khazana POS'}" <${process.env.FROM_EMAIL}>`,
      to: email,
      subject: 'Verify Your Email Address — Khazana POS',
      html: this.verificationTemplate(name, verifyUrl),
    });

    this.logger.log(`Verification email sent to ${email}`);
  }

  async sendPasswordResetEmail(email: string, code: string, name = 'User'): Promise<void> {
    await this.transporter.sendMail({
      from: `"${process.env.FROM_NAME ?? 'Khazana POS'}" <${process.env.FROM_EMAIL}>`,
      to: email,
      subject: 'Password Reset Code — Khazana POS',
      html: this.resetCodeTemplate(name, code),
    });

    this.logger.log(`Password reset email sent to ${email}`);
  }

  // ── Email Templates ───────────────────────────────────────────

  private verificationTemplate(name: string, verifyUrl: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f1f5f9;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08);">
    <div style="background:#1e293b;padding:28px 32px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Khazana POS</h1>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Point of Sale System</p>
    </div>
    <div style="padding:36px 32px;">
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:20px;">Verify your email address</h2>
      <p style="margin:0 0 28px;color:#475569;line-height:1.7;font-size:15px;">
        Hi <strong>${name}</strong>, thanks for registering. Click the button below to verify your email and activate your account.
      </p>
      <a href="${verifyUrl}" style="display:inline-block;background:#1e293b;color:#ffffff;padding:14px 32px;border-radius:7px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:.3px;">
        Verify Email Address
      </a>
      <p style="margin:28px 0 4px;color:#94a3b8;font-size:12px;">Or copy and paste this link into your browser:</p>
      <p style="margin:0 0 20px;font-size:12px;">
        <a href="${verifyUrl}" style="color:#64748b;word-break:break-all;">${verifyUrl}</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;">
      <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
        This link expires in <strong>24 hours</strong>. If you did not create an account, you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;
  }

  private resetCodeTemplate(name: string, code: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f1f5f9;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08);">
    <div style="background:#1e293b;padding:28px 32px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Khazana POS</h1>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Point of Sale System</p>
    </div>
    <div style="padding:36px 32px;">
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:20px;">Password Reset</h2>
      <p style="margin:0 0 28px;color:#475569;line-height:1.7;font-size:15px;">
        Hi <strong>${name}</strong>, use the 6-digit code below to reset your password. This code expires in <strong>10 minutes</strong>.
      </p>
      <div style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:10px;padding:24px;text-align:center;margin:0 0 28px;">
        <span style="display:block;font-size:42px;font-weight:800;letter-spacing:10px;color:#1e293b;font-family:'Courier New',monospace;">${code}</span>
        <p style="margin:8px 0 0;color:#64748b;font-size:12px;">One-time password reset code</p>
      </div>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;">
      <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
        If you did not request a password reset, please ignore this email. Your password will not be changed.
      </p>
    </div>
  </div>
</body>
</html>`;
  }
}
