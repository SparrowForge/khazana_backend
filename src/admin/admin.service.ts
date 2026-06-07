import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export class CreateBranchDto {
  branchCode: string;
  branchName: string;
  address?: string;
  vatNo?: string;
  mobileNo?: string;
}

export class UpdateSystemDto {
  companyName?: string;
  companyAddress?: string;
  companyUtility?: string;
  reportFooter?: string;
}

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // ── Branches ──────────────────────────────────────────────────

  findAllBranches() {
    return this.prisma.branch.findMany({ orderBy: { branchName: 'asc' } });
  }

  createBranch(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  updateBranch(id: string, dto: Partial<CreateBranchDto>) {
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  // ── System Settings ───────────────────────────────────────────

  async getSystemSettings() {
    return this.prisma.setup_System.findFirst();
  }

  async updateSystemSettings(dto: UpdateSystemDto) {
    const existing = await this.prisma.setup_System.findFirst();
    if (existing) {
      return this.prisma.setup_System.update({ where: { id: existing.id }, data: dto });
    }
    return this.prisma.setup_System.create({ data: { companyName: dto.companyName ?? 'Khazana Mithai', ...dto } });
  }

  // ── Audit Log ─────────────────────────────────────────────────

  findAuditLogs(take = 200) {
    return this.prisma.auditLog.findMany({
      orderBy: { date: 'desc' },
      take,
    });
  }

  // ── Banks ─────────────────────────────────────────────────────

  findAllBanks() {
    return this.prisma.bank.findMany();
  }

  createBank(name: string, createBy: string) {
    return this.prisma.bank.create({ data: { name, createBy, createDate: new Date() } });
  }
}
