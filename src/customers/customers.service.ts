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

  async update(code: string, dto: UpdateCustomerDto) {
    await this.findOne(code);
    return this.prisma.customer.update({ where: { code }, data: dto });
  }

  async getLedger(code: string) {
    const [sales, vatSales, payments] = await this.prisma.$transaction([
      this.prisma.cSMaster.findMany({
        where: { customer: { code }, isActive: 1 },
        include: { details: true },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.cSVMaster.findMany({
        where: { clientCode: code },
        include: { details: true },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.customer_Transaction.findMany({
        where: { customer: { code } },
        orderBy: { receiveDate: 'asc' },
      }),
    ]);
    return { sales, vatSales, payments };
  }

  async getBalance(code: string) {
    const customer = await this.findOne(code);
    const salesTotal = await this.prisma.cSMaster.aggregate({
      where: { customer: { code }, isActive: 1 },
      _sum: { totalAmount: true },
    });
    const paidTotal = await this.prisma.customer_Transaction.aggregate({
      where: { customer: { code } },
      _sum: { receiveAmount: true },
    });
    return {
      customer,
      totalSales: salesTotal._sum.totalAmount ?? 0,
      totalPaid: paidTotal._sum.receiveAmount ?? 0,
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
    // The /:code/payments route supplies a customer code; resolve it to the id.
    let customerId = dto.customerId;
    if (!customerId && dto.code) {
      const c = await this.prisma.customer.findUnique({
        where: { code: dto.code },
        select: { id: true },
      });
      customerId = c?.id;
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

  findPayments(code: string) {
    return this.prisma.customer_Transaction.findMany({
      where: { customer: { code } },
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

  async remove(code: string) {
    await this.findOne(code);
    await this.prisma.customer.delete({ where: { code } });
    return { message: 'Customer deleted successfully' };
  }
}
