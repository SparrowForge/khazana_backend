import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsArray, ValidateNested, IsUUID } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { BranchPaginationQueryDto } from '../common/dto';
import { buildPaginationMeta, branchScope, canAccessBranch } from '../common/helpers';

export class DemandOrderItemDto {
  @IsUUID()
  itemId: string;

  @IsNumber()
  qty: number;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CreateDemandOrderDto {
  @IsUUID()
  toBranchId: string;

  @IsUUID()
  @IsOptional()
  fromBranchId?: string;

  @IsString()
  @IsOptional()
  serialNo?: string;

  @IsString()
  @IsOptional()
  demandDate?: string;

  @IsString()
  @IsOptional()
  requiredDate?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DemandOrderItemDto)
  items: DemandOrderItemDto[];
}

@Injectable()
export class DemandOrdersService {
  constructor(private prisma: PrismaService) {}

  // A demand order concerns a branch on either end — surface it to the
  // branch that raised it (fromBranchId) as well as the factory it targets
  // (toBranchId), so the receiving side can see what's been submitted to them.
  async findAll(query: BranchPaginationQueryDto, accessibleBranchIds?: string[]) {
    const { page, limit, branchId } = query;
    // Visible to the branch that raised it AND the branch it was raised on, so a
    // factory user still sees every outlet's demand addressed to them. An
    // explicit `branchId` filter can only narrow the accessible set.
    const where = {
      isActive: 1,
      ...branchScope(accessibleBranchIds, ['fromBranchId', 'toBranchId'], branchId),
    };
    const [rows, total] = await Promise.all([
      this.prisma.demandOrder_Master.findMany({
        where,
        include: { details: true },
        orderBy: { createDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.demandOrder_Master.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string, accessibleBranchIds?: string[]) {
    const order = await this.prisma.demandOrder_Master.findUnique({
      where: { id },
      include: { details: true },
    });
    if (!order) throw new NotFoundException('Demand order not found');
    // Guarding the list alone would be theatre — the id is in every list
    // response, so the detail/edit/delete paths have to check it too.
    if (!canAccessBranch(accessibleBranchIds, order.fromBranchId, order.toBranchId)) {
      throw new ForbiddenException('This demand order belongs to another branch');
    }
    return order;
  }

  async create(dto: CreateDemandOrderDto, createdBy: string, userBranchId?: string) {
    const fromBranchId = dto.fromBranchId ?? userBranchId;
    const serialNo = dto.serialNo || (await this.generateSerialNo('DO', fromBranchId));
    return this.prisma.demandOrder_Master.create({
      data: {
        serialNo,
        fromBranchId,
        toBranchId: dto.toBranchId,
        demandDate: dto.demandDate ? new Date(dto.demandDate) : new Date(),
        requiredDate: dto.requiredDate ? new Date(dto.requiredDate) : undefined,
        remarks: dto.remarks,
        isActive: 1,
        createBy: createdBy,
        createDate: new Date(),
        details: {
          create: dto.items.map((item) => ({
            itemId: item.itemId,
            qty: item.qty,
            remarks: item.remarks,
            serialNo,
          })),
        },
      },
      include: { details: true },
    });
  }

  async update(id: string, dto: Partial<CreateDemandOrderDto>, updatedBy: string, accessibleBranchIds?: string[]) {
    const existing = await this.findOne(id, accessibleBranchIds);
    const { items, demandDate, requiredDate, ...rest } = dto;
    return this.prisma.demandOrder_Master.update({
      where: { id },
      data: {
        ...rest,
        demandDate: demandDate ? new Date(demandDate) : undefined,
        requiredDate: requiredDate ? new Date(requiredDate) : undefined,
        updateBy: updatedBy,
        updateDate: new Date(),
        // Purge-and-replace: detail lines are dropped and recreated when items are sent.
        ...(items && {
          details: {
            deleteMany: {},
            create: items.map((item) => ({
              itemId: item.itemId,
              qty: item.qty,
              remarks: item.remarks,
              serialNo: existing.serialNo,
            })),
          },
        }),
      },
      include: { details: true },
    });
  }

  async remove(id: string, accessibleBranchIds?: string[]) {
    await this.findOne(id, accessibleBranchIds);
    await this.prisma.$transaction([
      this.prisma.demandOrder_Detail.deleteMany({ where: { masterId: id } }),
      this.prisma.demandOrder_Master.delete({ where: { id } }),
    ]);
    return { message: 'Demand order deleted successfully' };
  }

  /** Resolve the session branch (a Branch UUID) to its sanitized branch code for
   *  embedding in DO serial numbers. Returns '' when the branch can't be
   *  resolved, so the number simply omits the code. */
  private async resolveBranchCode(branchId?: string | null): Promise<string> {
    if (branchId == null) return '';
    const id = String(branchId);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUuid) return '';
    const branch = await this.prisma.branch
      .findUnique({ where: { id }, select: { branchCode: true } })
      .catch(() => null);
    return (branch?.branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private yyyymm(d = new Date()): string {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private async generateSerialNo(prefix: string, branchId?: string | null): Promise<string> {
    const code = await this.resolveBranchCode(branchId);
    const count = await this.prisma.demandOrder_Master.count();
    return [prefix, code, this.yyyymm(), String(count + 1).padStart(5, '0')].filter(Boolean).join('-');
  }
}
