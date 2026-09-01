import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';
import { isFactoryBranch } from '../common/helpers/branch.helper';

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

  /** Display position on the reports and pickers that show one column per
   *  branch. Lowest first; leave it unset and the branch sorts last. */
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  sortingNo?: number;

  /** Whether the branch gets a column on the Demand Report. Defaults to true at
   *  the database, so omitting it creates a branch that appears on the sheet. */
  @IsBoolean()
  @IsOptional()
  showInDemandReport?: boolean;
}

/** PATCH body for a branch. Every field is optional, but it must be a real
 *  class: `Partial<CreateBranchDto>` loses its runtime type, so the global
 *  whitelist/forbidNonWhitelisted ValidationPipe would silently skip the body
 *  and pass unknown keys straight through to Prisma. */
export class UpdateBranchDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  branchCode?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  branchName?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  vatNo?: string;

  @IsString()
  @IsOptional()
  mobileNo?: string;

  /** Display position on the reports and pickers that show one column per
   *  branch. Lowest first; leave it unset and the branch sorts last. */
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  sortingNo?: number;

  /** Whether the branch gets a column on the Demand Report. */
  @IsBoolean()
  @IsOptional()
  showInDemandReport?: boolean;
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
      // Ordered the way the reports order their branch columns, so the screen
      // that maintains SortingNo shows the sequence it controls.
      this.prisma.branch.findMany({
        orderBy: [{ sortingNo: { sort: 'asc', nulls: 'last' } }, { branchName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.branch.count(),
    ]);
    return { items: branches, meta: buildPaginationMeta(total, page, limit) };
  }

  private async findOneBranch(id: string) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  /** BranchCode is @unique. Reject a duplicate here so it comes back as a 409
   *  with a readable message instead of an opaque Prisma P2002 500. */
  private async assertBranchCodeFree(code: string, exceptId?: string) {
    const clash = await this.prisma.branch.findFirst({
      where: { branchCode: code, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { branchName: true },
    });
    if (clash) throw new ConflictException(`Branch code "${code}" is already used by ${clash.branchName ?? 'another branch'}`);
  }

  async createBranch(dto: CreateBranchDto) {
    const branchCode = dto.branchCode.trim();
    await this.assertBranchCodeFree(branchCode);
    return this.prisma.branch.create({ data: { ...dto, branchCode } });
  }

  /** Branch code is editable. Nothing references it as a foreign key — every
   *  other table stores the Branch UUID (`BranchId`) — so a rename is safe for
   *  referential integrity. Two side effects are worth knowing about:
   *  1. Document serials (GRN-/ISS-/TRF-/ADJ-/MR-/POS…) embed the code at the
   *     moment they are generated. Existing documents keep the old code; new
   *     ones get the new one. That is a display/numbering change only.
   *  2. The factory is identified by convention on code/name (isFactoryBranch),
   *     not by a column, so an edit that would stop the factory looking like the
   *     factory is refused — it would silently disable the factory-only screens. */
  async updateBranch(id: string, dto: UpdateBranchDto) {
    const existing = await this.findOneBranch(id);
    const data: UpdateBranchDto = { ...dto };

    if (data.branchCode !== undefined) {
      data.branchCode = data.branchCode.trim();
      if (data.branchCode !== existing.branchCode) {
        await this.assertBranchCodeFree(data.branchCode, id);
      }
    }

    const after = { branchCode: data.branchCode ?? existing.branchCode, branchName: data.branchName ?? existing.branchName };
    if (isFactoryBranch(existing) && !isFactoryBranch(after)) {
      throw new ConflictException(
        'This is the factory branch — keep "FAC" as its code or "Factory" in its name, otherwise the factory-only screens (Production, Demand, Branchwise Delivery) stop working',
      );
    }

    return this.prisma.branch.update({ where: { id }, data });
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
