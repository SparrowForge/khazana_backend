import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

export class CreateCustomerDto {
  code: string;
  name: string;
  mobile?: string;
  address?: string;
  email?: string;
  joiningDate?: string;
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({ orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.customer.count(),
    ]);
    return { items: customers, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(code: string) {
    const customer = await this.prisma.customer.findUnique({ where: { code } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(dto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Customer code already exists');
    return this.prisma.customer.create({
      data: { ...dto, joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined },
    });
  }

  async update(code: string, dto: Partial<CreateCustomerDto>) {
    await this.findOne(code);
    return this.prisma.customer.update({ where: { code }, data: dto });
  }

  async getLedger(code: string) {
    const [sales, vatSales, payments] = await this.prisma.$transaction([
      this.prisma.cSMaster.findMany({
        where: { clientCode: code, isActive: 1 },
        include: { details: true },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.cSVMaster.findMany({
        where: { clientCode: code },
        include: { details: true },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.client_Transaction.findMany({
        where: { clientCode: code },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);
    return { sales, vatSales, payments };
  }

  async getBalance(code: string) {
    const customer = await this.findOne(code);
    const salesTotal = await this.prisma.cSMaster.aggregate({
      where: { clientCode: code, isActive: 1 },
      _sum: { totalAmount: true },
    });
    const paidTotal = await this.prisma.client_Transaction.aggregate({
      where: { clientCode: code },
      _sum: { paymentAmount: true },
    });
    return {
      customer,
      totalSales: salesTotal._sum.totalAmount ?? 0,
      totalPaid: paidTotal._sum.paymentAmount ?? 0,
    };
  }

  async addPayment(dto: {
    clientCode: string;
    paymentDate: string;
    paymentAmount: number;
    tType?: string;
    moneyReceptNo?: string;
    bankName?: string;
    bankNo?: string;
  }) {
    return this.prisma.client_Transaction.create({
      data: {
        clientCode: dto.clientCode,
        paymentDate: new Date(dto.paymentDate),
        paymentAmount: dto.paymentAmount,
        tType: dto.tType,
        moneyReceptNo: dto.moneyReceptNo,
        bankName: dto.bankName,
        bankNo: dto.bankNo,
      },
    });
  }

  findPayments(clientCode: string) {
    return this.prisma.client_Transaction.findMany({
      where: { clientCode },
      orderBy: { paymentDate: 'desc' },
    });
  }

  async findAllPayments(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [payments, total] = await Promise.all([
      this.prisma.client_Transaction.findMany({
        include: { customer: { select: { name: true } } },
        orderBy: { paymentDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client_Transaction.count(),
    ]);
    return { items: payments, meta: buildPaginationMeta(total, page, limit) };
  }

  async remove(code: string) {
    await this.findOne(code);
    await this.prisma.customer.delete({ where: { code } });
    return { message: 'Customer deleted successfully' };
  }
}
