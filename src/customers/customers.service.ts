import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta, toBranchUuid } from '../common/helpers';

export class CreateCustomerDto {
  @ApiProperty({ example: '001', description: 'Unique customer code' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'Fazlu', description: 'Customer name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: '01700000000' })
  @IsString()
  @IsOptional()
  mobile?: string;

  @ApiPropertyOptional({ example: 'Dhaka' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'customer@example.com' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '2026-06-24' })
  @IsString()
  @IsOptional()
  joiningDate?: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ example: 'Fazlu' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: '01700000000' })
  @IsString()
  @IsOptional()
  mobile?: string;

  @ApiPropertyOptional({ example: 'Dhaka' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'customer@example.com' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '2026-06-24' })
  @IsString()
  @IsOptional()
  joiningDate?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown) => Number(v ?? 0);

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  // Routes historically take the customer code, but newer frontend pages link
  // by the uuid PK (CustomerID migration) — accept either.
  private async resolveCustomer(idOrCode: string) {
    const customer = await this.prisma.customer.findUnique({
      where: UUID_RE.test(idOrCode) ? { id: idOrCode } : { code: idOrCode },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async findAll(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({ orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.customer.count(),
    ]);
    return { items: customers, meta: buildPaginationMeta(total, page, limit) };
  }

  findOne(idOrCode: string) {
    return this.resolveCustomer(idOrCode);
  }

  async create(dto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Customer code already exists');
    return this.prisma.customer.create({
      data: { ...dto, joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined },
    });
  }

  async update(idOrCode: string, dto: UpdateCustomerDto) {
    const customer = await this.resolveCustomer(idOrCode);
    return this.prisma.customer.update({ where: { id: customer.id }, data: dto });
  }

  // Ledger formula: outstanding = credit sales − money receipts − order advances.
  // Debits are net credit sales (CSMaster + CSVMaster, net of discount); credits
  // are money receipts (Customer_Transaction) and order advance payments
  // (OrderReceive_Master.advance). CSVMaster and OrderReceive_Master still key
  // on the string ClientCode (uuid migration pending), so those two filter by
  // customer.code while CSMaster/Customer_Transaction use the uuid FK.
  async getLedger(idOrCode: string) {
    const customer = await this.resolveCustomer(idOrCode);
    const [sales, vatSales, payments, advances] = await this.prisma.$transaction([
      this.prisma.cSMaster.findMany({
        where: { customerId: customer.id, isActive: 1 },
        select: { id: true, invNo: true, invDate: true, totalAmount: true, totalDiscount: true },
      }),
      this.prisma.cSVMaster.findMany({
        where: { clientCode: customer.code },
        select: { id: true, invNo: true, invDate: true, totalAmount: true, totalDiscount: true },
      }),
      this.prisma.customer_Transaction.findMany({
        where: { customerId: customer.id },
        select: { id: true, receiveDate: true, receiveAmount: true, tType: true, moneyReceptNo: true },
      }),
      this.prisma.orderReceive_Master.findMany({
        where: { clientCode: customer.code, isActive: 1, advance: { gt: 0 } },
        select: { id: true, serialNo: true, orderDate: true, advance: true },
      }),
    ]);

    const entries = [
      ...sales.map((s) => ({
        id: s.id,
        date: s.invDate,
        description: `Credit Sale — Inv ${s.invNo}`,
        debit: num(s.totalAmount) - num(s.totalDiscount),
        credit: 0,
      })),
      ...vatSales.map((s) => ({
        id: s.id,
        date: s.invDate,
        description: `Credit Sale (VAT) — Inv ${s.invNo}`,
        debit: num(s.totalAmount) - num(s.totalDiscount),
        credit: 0,
      })),
      ...payments.map((p) => ({
        id: p.id,
        date: p.receiveDate,
        description: `Money Receipt${p.moneyReceptNo ? ` #${p.moneyReceptNo}` : ''}${p.tType ? ` (${p.tType})` : ''}`,
        debit: 0,
        credit: num(p.receiveAmount),
      })),
      ...advances.map((o) => ({
        id: o.id,
        date: o.orderDate,
        description: `Order Advance${o.serialNo ? ` — Order ${o.serialNo}` : ''}`,
        debit: 0,
        credit: num(o.advance),
      })),
    ].sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));

    let balance = 0;
    const items = entries.map((e) => {
      balance += e.debit - e.credit;
      return { ...e, balance };
    });

    const totalDebit = items.reduce((s, e) => s + e.debit, 0);
    const totalCredit = items.reduce((s, e) => s + e.credit, 0);
    return {
      data: {
        items,
        summary: { totalSales: totalDebit, totalPayments: totalCredit, balance },
      },
      customer: { code: customer.code, name: customer.name },
    };
  }

  async getBalance(idOrCode: string) {
    const customer = await this.resolveCustomer(idOrCode);
    const [salesTotal, vatSalesTotal, paidTotal, advanceTotal] = await this.prisma.$transaction([
      this.prisma.cSMaster.aggregate({
        where: { customerId: customer.id, isActive: 1 },
        _sum: { totalAmount: true, totalDiscount: true },
      }),
      this.prisma.cSVMaster.aggregate({
        where: { clientCode: customer.code },
        _sum: { totalAmount: true, totalDiscount: true },
      }),
      this.prisma.customer_Transaction.aggregate({
        where: { customerId: customer.id },
        _sum: { receiveAmount: true },
      }),
      this.prisma.orderReceive_Master.aggregate({
        where: { clientCode: customer.code, isActive: 1, advance: { gt: 0 } },
        _sum: { advance: true },
      }),
    ]);
    const totalSales =
      num(salesTotal._sum.totalAmount) - num(salesTotal._sum.totalDiscount) +
      num(vatSalesTotal._sum.totalAmount) - num(vatSalesTotal._sum.totalDiscount);
    const totalPaid = num(paidTotal._sum.receiveAmount);
    const totalAdvance = num(advanceTotal._sum.advance);
    return {
      customer,
      totalSales,
      totalPaid,
      totalAdvance,
      balance: totalSales - totalPaid - totalAdvance,
    };
  }

  async addPayment(dto: {
    customerId?: string;
    code?: string;
    receiveDate: string;
    receiveAmount: number;
    tType?: string;
    moneyReceptNo?: string;
    bankName?: string;
    bankNo?: string;
    branchId?: string;
  }) {
    // The /:code/payments route supplies a customer code (or uuid); resolve to the id.
    let customerId = dto.customerId;
    if (!customerId && dto.code) {
      const c = await this.resolveCustomer(dto.code);
      customerId = c.id;
    }
    return this.prisma.customer_Transaction.create({
      data: {
        customerId,
        receiveDate: new Date(dto.receiveDate),
        receiveAmount: dto.receiveAmount,
        tType: dto.tType,
        moneyReceptNo: dto.moneyReceptNo,
        bankName: dto.bankName,
        bankNo: dto.bankNo,
        branchId: toBranchUuid(dto.branchId),
      },
    });
  }

  async findPayments(idOrCode: string) {
    const customer = await this.resolveCustomer(idOrCode);
    return this.prisma.customer_Transaction.findMany({
      where: { customerId: customer.id },
      orderBy: { receiveDate: 'desc' },
    });
  }

  async findAllPayments(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [payments, total] = await Promise.all([
      this.prisma.customer_Transaction.findMany({
        include: { customer: { select: { code: true, name: true } } },
        orderBy: { receiveDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customer_Transaction.count(),
    ]);
    return { items: payments, meta: buildPaginationMeta(total, page, limit) };
  }

  async remove(idOrCode: string) {
    const customer = await this.resolveCustomer(idOrCode);
    await this.prisma.customer.delete({ where: { id: customer.id } });
    return { message: 'Customer deleted successfully' };
  }
}
