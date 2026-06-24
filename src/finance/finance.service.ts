import { Injectable } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

export class CreateMoneyReceiveDto {
  @IsString()
  @IsNotEmpty()
  receiptNo: string;

  @IsString()
  @IsNotEmpty()
  receiptDate: string;

  @IsString()
  @IsNotEmpty()
  customerCode: string;

  @IsNumber()
  amount: number;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateCashPurchaseDto {
  @IsString()
  @IsNotEmpty()
  voucherNo: string;

  @IsString()
  @IsNotEmpty()
  voucherDate: string;

  @IsString()
  @IsOptional()
  supplier?: string;

  @IsNumber()
  amount: number;

  @IsString()
  @IsOptional()
  description?: string;
}

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  // ── Money Receive ─────────────────────────────────────────────

  async findAllMoneyReceive(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [rows, total] = await Promise.all([
      this.prisma.moneyReceive.findMany({ include: { customer: true }, orderBy: { receiptDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.moneyReceive.count(),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  createMoneyReceive(dto: CreateMoneyReceiveDto, createdBy: string) {
    return this.prisma.moneyReceive.create({
      data: {
        receiptNo: dto.receiptNo,
        receiptDate: new Date(dto.receiptDate),
        customerCode: dto.customerCode,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        description: dto.description,
        createdBy,
      },
    });
  }

  // ── Cash Purchase ─────────────────────────────────────────────

  async findAllCashPurchases(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [rows, total] = await Promise.all([
      this.prisma.cashPurchase.findMany({ orderBy: { voucherDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.cashPurchase.count(),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  createCashPurchase(dto: CreateCashPurchaseDto, createdBy: string) {
    return this.prisma.cashPurchase.create({
      data: {
        voucherNo: dto.voucherNo,
        voucherDate: new Date(dto.voucherDate),
        supplier: dto.supplier,
        amount: dto.amount,
        description: dto.description,
        createdBy,
      },
    });
  }
}
