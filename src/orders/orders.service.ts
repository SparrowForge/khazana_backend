import { Injectable, NotFoundException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested, IsUUID } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { BranchPaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

export class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  itemCode: string;

  @IsNumber()
  qty: number;

  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @IsNumber()
  @IsOptional()
  vatPrice?: number;

  @IsNumber()
  @IsOptional()
  amount?: number;
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  clientCode: string;

  @IsString()
  @IsOptional()
  serialNo?: string;

  @IsNumber()
  @IsOptional()
  advance?: number;

  @IsString()
  @IsOptional()
  orderDate?: string;

  @IsNumber()
  @IsOptional()
  totalPrice?: number;

  @IsNumber()
  @IsOptional()
  discount?: number;

  @IsString()
  @IsOptional()
  deliveryDate?: string;

  @IsString()
  @IsOptional()
  deliveryAddress?: string;

  @IsString()
  @IsOptional()
  cType?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsString()
  @IsOptional()
  deliveryTime?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  // ── Regular Orders ────────────────────────────────────────────

  async findAll(query: BranchPaginationQueryDto) {
    const { page, limit, branchId } = query;
    const where = { isActive: 1, ...(branchId && { branchId }) };
    const [rows, total] = await Promise.all([
      this.prisma.orderReceive_Master.findMany({ where, include: { details: true }, orderBy: { orderDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.orderReceive_Master.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const order = await this.prisma.orderReceive_Master.findUnique({
      where: { id },
      include: { details: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async create(dto: CreateOrderDto, createdBy: string, userBranchId?: string) {
    const serialNo = dto.serialNo || (await this.generateSerialNo('ORD', dto.branchId ?? userBranchId));
    return this.prisma.orderReceive_Master.create({
      data: {
        clientCode: dto.clientCode,
        serialNo,
        advance: dto.advance,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(),
        totalPrice: dto.totalPrice,
        discount: dto.discount,
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
        deliveryAddress: dto.deliveryAddress,
        cType: dto.cType,
        branchId: dto.branchId,
        deliveryTime: dto.deliveryTime ? new Date(dto.deliveryTime) : undefined,
        isActive: 1,
        createBy: createdBy,
        createDate: new Date(),
        details: {
          create: dto.items.map((item) => ({
            itemCode: item.itemCode,
            qty: item.qty,
            unitPrice: item.unitPrice,
            vatPrice: item.vatPrice,
            amount: item.amount,
            serialNo,
          })),
        },
      },
      include: { details: true },
    });
  }

  async update(id: string, dto: Partial<CreateOrderDto>, updatedBy: string) {
    const existing = await this.findOne(id);
    const { items, orderDate, deliveryDate, deliveryTime, ...rest } = dto;
    return this.prisma.orderReceive_Master.update({
      where: { id },
      data: {
        ...rest,
        orderDate: orderDate ? new Date(orderDate) : undefined,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
        deliveryTime: deliveryTime ? new Date(deliveryTime) : undefined,
        updateBy: updatedBy,
        updateDate: new Date(),
        // Purge-and-replace: detail lines are dropped and recreated when items are sent.
        ...(items && {
          details: {
            deleteMany: {},
            create: items.map((item) => ({
              itemCode: item.itemCode,
              qty: item.qty,
              unitPrice: item.unitPrice,
              vatPrice: item.vatPrice,
              amount: item.amount,
              serialNo: existing.serialNo,
            })),
          },
        }),
      },
      include: { details: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.$transaction([
      this.prisma.orderReceive_Detail.deleteMany({ where: { masterId: id } }),
      this.prisma.orderReceive_Master.delete({ where: { id } }),
    ]);
    return { message: 'Order deleted successfully' };
  }

  // ── VAT Orders ────────────────────────────────────────────────

  async findAllVat(query: BranchPaginationQueryDto) {
    const { page, limit, branchId } = query;
    const where = branchId ? { branchId } : {};
    const [rows, total] = await Promise.all([
      this.prisma.vOrderReceive_Master.findMany({ where, include: { details: true }, orderBy: { orderDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.vOrderReceive_Master.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async createVat(dto: Omit<CreateOrderDto, 'totalPrice' | 'discount'>, createdBy: string) {
    return this.prisma.vOrderReceive_Master.create({
      data: {
        clientCode: dto.clientCode,
        serialNo: dto.serialNo,
        advance: dto.advance,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(),
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
        deliveryAddress: dto.deliveryAddress,
        cType: dto.cType,
        branchId: dto.branchId,
        createBy: createdBy,
        createDate: new Date(),
        details: {
          create: dto.items.map((item) => ({
            itemCode: item.itemCode,
            qty: item.qty,
            unitPrice: item.unitPrice,
            serialNo: dto.serialNo,
          })),
        },
      },
      include: { details: true },
    });
  }

  /** Resolve the session branch (a Branch UUID) to its sanitized branch code for
   *  embedding in order numbers. Returns '' when the branch can't be resolved,
   *  so the number simply omits the code. */
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
    const count = await this.prisma.orderReceive_Master.count();
    return [prefix, code, this.yyyymm(), String(count + 1).padStart(5, '0')].filter(Boolean).join('-');
  }
}
