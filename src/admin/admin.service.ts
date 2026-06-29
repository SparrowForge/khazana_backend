import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  branchCode: string;

  @IsString()
  @IsNotEmpty()
  branchName: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  vatNo?: string;

  @IsString()
  @IsOptional()
  mobileNo?: string;
}

export class UpdateSystemDto {
  @IsString()
  @IsOptional()
  companyName?: string;

  @IsString()
  @IsOptional()
  companyAddress?: string;

  @IsString()
  @IsOptional()
  companyUtility?: string;

  @IsString()
  @IsOptional()
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
      this.prisma.bank.findMany({ orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.bank.count(),
    ]);
    return { items: banks, meta: buildPaginationMeta(total, page, limit) };
  }

  private async findOneBank(id: string) {
    const bank = await this.prisma.bank.findUnique({ where: { id } });
    if (!bank) throw new NotFoundException('Bank not found');
    return bank;
  }

  createBank(name: string, createBy: string) {
    return this.prisma.bank.create({ data: { name, createBy, createDate: new Date() } });
  }

  async updateBank(id: string, name: string) {
    await this.findOneBank(id);
    return this.prisma.bank.update({ where: { id }, data: { name } });
  }

  async removeBank(id: string) {
    await this.findOneBank(id);
    // Bank is referenced by card sales (t_SOMstr.soMstrMBank) — block the delete
    // rather than letting the FK constraint surface as an opaque 500.
    const linked = await this.prisma.t_SOMstr.count({ where: { soMstrMBank: id } });
    if (linked > 0) throw new ConflictException(`Cannot delete — bank is used by ${linked} sale(s)`);
    await this.prisma.bank.delete({ where: { id } });
    return { message: 'Bank deleted successfully' };
  }
}
