import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { BranchPaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

export class CreateOrderDto {
  clientCode: string;
  serialNo?: string;
  advance?: number;
  orderDate?: string;
  totalPrice?: number;
  discount?: number;
  deliveryDate?: string;
  deliveryAddress?: string;
  cType?: string;
  branchId?: number;
  deliveryTime?: string;
  items: { itemCode: string; qty: number; unitPrice?: number; vatPrice?: number; amount?: number }[];
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

  async create(dto: CreateOrderDto, createdBy: string) {
    return this.prisma.orderReceive_Master.create({
      data: {
        clientCode: dto.clientCode,
        serialNo: dto.serialNo,
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
            serialNo: dto.serialNo,
          })),
        },
      },
      include: { details: true },
    });
  }

  async update(id: string, dto: Partial<CreateOrderDto>, updatedBy: string) {
    await this.findOne(id);
    const { items, ...rest } = dto;
    return this.prisma.orderReceive_Master.update({
      where: { id },
      data: { ...rest, updateBy: updatedBy, updateDate: new Date() },
    });
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
}
