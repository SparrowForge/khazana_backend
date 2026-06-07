import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export class CreateMoneyReceiveDto {
  receiptNo: string;
  receiptDate: string;
  customerCode: string;
  amount: number;
  paymentMethod?: string;
  description?: string;
}

export class CreateCashPurchaseDto {
  voucherNo: string;
  voucherDate: string;
  supplier?: string;
  amount: number;
  description?: string;
}

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  // ── Money Receive ─────────────────────────────────────────────

  findAllMoneyReceive() {
    return this.prisma.moneyReceive.findMany({
      include: { customer: true },
      orderBy: { receiptDate: 'desc' },
    });
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

  findAllCashPurchases() {
    return this.prisma.cashPurchase.findMany({ orderBy: { voucherDate: 'desc' } });
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
