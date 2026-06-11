import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

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

  async findAllBranches(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [branches, total] = await Promise.all([
      this.prisma.branch.findMany({ orderBy: { branchName: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.branch.count(),
    ]);
    return { items: branches, meta: buildPaginationMeta(total, page, limit) };
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

  async findAllBanks(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [banks, total] = await Promise.all([
      this.prisma.bank.findMany({ skip: (page - 1) * limit, take: limit }),
      this.prisma.bank.count(),
    ]);
    return { items: banks, meta: buildPaginationMeta(total, page, limit) };
  }

  createBank(name: string, createBy: string) {
    return this.prisma.bank.create({ data: { name, createBy, createDate: new Date() } });
  }
}
