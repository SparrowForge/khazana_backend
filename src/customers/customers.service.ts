import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta, roundPayable, toBranchUuid } from '../common/helpers';

export class CreateCustomerDto {
  @ApiPropertyOptional({
    example: 'C-1002',
    description: 'Unique customer code. Leave blank (or omit) to auto-generate the next C-nnnn.',
  })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty({ example: 'Fazlu', description: 'Customer name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '01700000000', description: 'Customer mobile number' })
  @IsString()
  @IsNotEmpty()
  mobile: string;

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

  @ApiPropertyOptional({
    example: 5,
    description:
      "The customer's standing discount %, on the VAT-inclusive total. Seeds the invoice-level discount of a credit sale raised for them; the operator can still change it on the invoice.",
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  defaultDiscount?: number;
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

  @ApiPropertyOptional({
    example: 5,
    description:
      "The customer's standing discount %, on the VAT-inclusive total. Seeds the invoice-level discount of a credit sale raised for them; the operator can still change it on the invoice.",
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  defaultDiscount?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown) => Number(v ?? 0);

function yyyymm(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Builds a khazana-style serial: PREFIX-BRANCHCODE-YYYYMM-00001 — same rule
 *  used for the inventory serials (GRN/ISS/TRF/ADJ) in InventoryService. */
function buildSerialNo(prefix: string, branchCode: string, seq: number): string {
  return [prefix, branchCode, yyyymm(), String(seq).padStart(5, '0')].filter(Boolean).join('-');
}

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

  /** Resolve the session branch (a Branch UUID) to its sanitized branch code for
   *  embedding in generated serial numbers. Returns '' when the branch can't be
   *  resolved, so the number simply omits the code. */
  private async resolveBranchCode(branchId?: string | null): Promise<string> {
    if (branchId == null || !UUID_RE.test(String(branchId))) return '';
    const branch = await this.prisma.branch.findUnique({ where: { id: String(branchId) }, select: { branchCode: true } }).catch(() => null);
    return (branch?.branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
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

  /**
   * Next free auto code, continuing the existing `C-nnnn` series: the highest
   * number already issued, plus one.
   *
   * Only `C-<digits>` codes are counted. Customers created by hand carry all
   * sorts of codes ('001', 'TEST-001'), and letting those set the counter would
   * make the next auto code depend on whatever someone last typed. The result is
   * checked for a free slot regardless, so a hand-typed 'C-1005' can't be
   * collided with later.
   */
  private async generateCustomerCode(): Promise<string> {
    const rows = await this.prisma.customer.findMany({
      where: { code: { startsWith: 'C-' } },
      select: { code: true },
    });
    const highest = rows.reduce((max, r) => {
      const m = /^C-(\d+)$/.exec(r.code);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);

    // Walk forward past anything already taken — the gap can only be a code
    // someone entered by hand, so a handful of tries always clears it.
    for (let n = highest + 1; n <= highest + 100; n++) {
      const code = `C-${String(n).padStart(4, '0')}`;
      const taken = await this.prisma.customer.findUnique({ where: { code }, select: { id: true } });
      if (!taken) return code;
    }
    throw new ConflictException('Could not allocate a customer code — enter one manually');
  }

  async create(dto: CreateCustomerDto) {
    // A blank code from the form means "auto-generate" — the field is read-only
    // in the UI, so this is the normal path; an explicit code still wins.
    const code = dto.code?.trim() || (await this.generateCustomerCode());
    const existing = await this.prisma.customer.findUnique({ where: { code } });
    if (existing) throw new ConflictException('Customer code already exists');
    return this.prisma.customer.create({
      data: { ...dto, code, joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined },
    });
  }

  async update(idOrCode: string, dto: UpdateCustomerDto) {
    const customer = await this.resolveCustomer(idOrCode);
    return this.prisma.customer.update({ where: { id: customer.id }, data: dto });
  }

  // Ledger formula: outstanding = credit sales − money receipts − order advances.
  // A credit sale's debit is TotalAmount + TotalVat − TotalDiscount: TotalAmount
  // is net of VAT, so dropping TotalVat under-bills the customer by the whole
  // VAT of every invoice.
  // Debits are net credit sales (CSMaster + CSVMaster, net of discount); credits
  // are money receipts (Customer_Transaction) and order advance payments
  // (OrderReceive_Master.advance). CSVMaster still keys on the string
  // ClientCode (uuid migration pending), so it filters by customer.code, while
  // CSMaster/Customer_Transaction/OrderReceive_Master use the uuid FK.
  async getLedger(idOrCode: string) {
    const customer = await this.resolveCustomer(idOrCode);
    const [sales, vatSales, payments, advances] = await this.prisma.$transaction([
      this.prisma.cSMaster.findMany({
        where: { customerId: customer.id, isActive: 1 },
        select: { id: true, invNo: true, invDate: true, totalAmount: true, totalVat: true, totalDiscount: true },
      }),
      this.prisma.cSVMaster.findMany({
        where: { clientCode: customer.code },
        select: { id: true, invNo: true, invDate: true, totalAmount: true, totalVat: true, totalDiscount: true },
      }),
      this.prisma.customer_Transaction.findMany({
        where: { customerId: customer.id },
        select: { id: true, receiveDate: true, receiveAmount: true, tType: true, moneyReceptNo: true },
      }),
      this.prisma.orderReceive_Master.findMany({
        where: { clientId: customer.id, isActive: 1, advance: { gt: 0 } },
        select: { id: true, serialNo: true, orderDate: true, advance: true },
      }),
    ]);

    const entries = [
      ...sales.map((s) => ({
        id: s.id,
        date: s.invDate,
        description: `Credit Sale — Inv ${s.invNo}`,
        // Rounded to the whole taka, matching what the invoice charges — the
        // ledger and the invoice a customer holds must not disagree.
        debit: roundPayable(num(s.totalAmount) + num(s.totalVat) - num(s.totalDiscount)),
        credit: 0,
      })),
      ...vatSales.map((s) => ({
        id: s.id,
        date: s.invDate,
        description: `Credit Sale (VAT) — Inv ${s.invNo}`,
        debit: roundPayable(num(s.totalAmount) + num(s.totalVat) - num(s.totalDiscount)),
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
    // Read per invoice rather than aggregating in SQL: each invoice's payable is
    // rounded to the whole taka, and the sum of the rounded amounts is not the
    // rounding of the sum. A _sum here would drift from the ledger, which is the
    // same figures listed one by one.
    const [sales, vatSales, paidTotal, advanceTotal] = await this.prisma.$transaction([
      this.prisma.cSMaster.findMany({
        where: { customerId: customer.id, isActive: 1 },
        select: { totalAmount: true, totalVat: true, totalDiscount: true },
      }),
      this.prisma.cSVMaster.findMany({
        where: { clientCode: customer.code },
        select: { totalAmount: true, totalVat: true, totalDiscount: true },
      }),
      this.prisma.customer_Transaction.aggregate({
        where: { customerId: customer.id },
        _sum: { receiveAmount: true },
      }),
      this.prisma.orderReceive_Master.aggregate({
        where: { clientId: customer.id, isActive: 1, advance: { gt: 0 } },
        _sum: { advance: true },
      }),
    ]);
    const invoiceTotal = (rows: { totalAmount: unknown; totalVat: unknown; totalDiscount: unknown }[]) =>
      rows.reduce(
        (s, r) => s + roundPayable(num(r.totalAmount) + num(r.totalVat) - num(r.totalDiscount)),
        0,
      );
    const totalSales = invoiceTotal(sales) + invoiceTotal(vatSales);
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
    const branchId = toBranchUuid(dto.branchId);
    const branchCode = await this.resolveBranchCode(dto.branchId);
    const baseCount = await this.prisma.customer_Transaction.count();
    const moneyReceptNo = dto.moneyReceptNo || buildSerialNo('MR', branchCode, baseCount + 1);
    return this.prisma.customer_Transaction.create({
      data: {
        customerId,
        receiveDate: new Date(dto.receiveDate),
        receiveAmount: dto.receiveAmount,
        tType: dto.tType,
        moneyReceptNo,
        bankName: dto.bankName,
        bankNo: dto.bankNo,
        branchId,
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
