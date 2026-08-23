import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested, IsUUID, IsIn } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { BranchPaginationQueryDto } from '../common/dto';
import { allocateDiscount, buildPaginationMeta, branchScope, canAccessBranch } from '../common/helpers';

/** Money rounding — 2dp, matching the order form's client-side maths. */
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Query for GET /orders. `clientId` is what drives the credit sale's PO
 *  picker — once an invoice has a customer, only that customer's orders are
 *  offered — and `deliveryStatus` keeps already-invoiced orders out of it. */
export class OrderQueryDto extends BranchPaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by customer UUID' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    enum: ['pending', 'done'],
    description: "'pending' = not yet invoiced out, 'done' = a credit sale carries this order's number",
  })
  @IsOptional()
  @IsIn(['pending', 'done'])
  deliveryStatus?: 'pending' | 'done';
}

export class OrderItemDto {
  @IsUUID()
  itemId: string;

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
  @IsUUID()
  clientId: string;

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

// VAT orders (VOrderReceive_Master/Detail) still key on the legacy string
// ClientCode/ItemCode — unlike CreateOrderDto/OrderItemDto above, which moved
// to uuid ClientID/ItemID FKs on the regular OrderReceive_Master/Detail.
export class VatOrderItemDto {
  @IsString()
  @IsNotEmpty()
  itemCode: string;

  @IsNumber()
  qty: number;

  @IsNumber()
  @IsOptional()
  unitPrice?: number;
}

export class CreateVatOrderDto {
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
  @Type(() => VatOrderItemDto)
  items: VatOrderItemDto[];
}

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  // ── Regular Orders ────────────────────────────────────────────

  async findAll(query: OrderQueryDto, accessibleBranchIds?: string[]) {
    const { page, limit, branchId, clientId, deliveryStatus } = query;
    // Delivery status isn't stored on the order — it's derived from the credit
    // sales that carry its number — so it has to be resolved to a serialNo set
    // up front; filtering the page after the fact would skew total/pageCount.
    const invoiced = deliveryStatus ? [...(await this.invoicedPoNos())] : [];
    const where = {
      isActive: 1,
      // An explicit branchId can only narrow the caller's accessible set.
      ...branchScope(accessibleBranchIds, ['branchId'], branchId),
      ...(clientId && { clientId }),
      ...(deliveryStatus === 'done' && { serialNo: { in: invoiced } }),
      // `notIn` alone would also drop rows with no order number (SQL NOT IN vs
      // NULL); an unnumbered order can't have been invoiced, so it's pending.
      ...(deliveryStatus === 'pending' && {
        OR: [{ serialNo: null }, { serialNo: { notIn: invoiced } }],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.orderReceive_Master.findMany({ where, include: { details: true }, orderBy: { orderDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.orderReceive_Master.count({ where }),
    ]);
    const delivered = await this.deliveredSerialNos(rows.map((r) => r.serialNo));
    const items = rows.map((r) => ({
      ...r,
      deliveryStatus: r.serialNo && delivered.has(r.serialNo) ? 'Delivery Done' : 'Delivery Pending',
    }));
    return { items, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string, accessibleBranchIds?: string[]) {
    const order = await this.prisma.orderReceive_Master.findUnique({
      where: { id },
      // Detail lines carry the item as a uuid FK only; the item summary rides
      // along so a consumer (the credit sale's "bill this order" prefill) can
      // name the line without re-fetching the whole item catalog.
      include: { details: { include: { item: { select: { id: true, itmCode: true, itmName: true } } } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    // The id appears in every list response, so the detail/edit/delete paths
    // need the same check the list applies.
    if (!canAccessBranch(accessibleBranchIds, order.branchId)) {
      throw new ForbiddenException('This order belongs to another branch');
    }
    const delivered = await this.deliveredSerialNos([order.serialNo]);
    return {
      ...order,
      deliveryStatus: order.serialNo && delivered.has(order.serialNo) ? 'Delivery Done' : 'Delivery Pending',
    };
  }

  /** Order numbers that a credit sale has already been raised against — the
   *  credit sale's PO No carries the order's serialNo, so a match means the
   *  order has been invoiced out (delivered). Both credit tables are checked. */
  private async deliveredSerialNos(serialNos: (string | null)[]): Promise<Set<string>> {
    const keys = serialNos.filter((s): s is string => !!s);
    if (!keys.length) return new Set();
    const [credit, vatCredit] = await Promise.all([
      this.prisma.cSMaster.findMany({ where: { poNo: { in: keys } }, select: { poNo: true } }),
      this.prisma.cSVMaster.findMany({ where: { poNo: { in: keys } }, select: { poNo: true } }),
    ]);
    return new Set([...credit, ...vatCredit].map((r) => r.poNo).filter((p): p is string => !!p));
  }

  /** Every order number any credit sale has been raised against — the whole-set
   *  form of `deliveredSerialNos`, used to filter the list by delivery status
   *  before paginating. */
  private async invoicedPoNos(): Promise<Set<string>> {
    const [credit, vatCredit] = await Promise.all([
      this.prisma.cSMaster.findMany({ where: { poNo: { not: null } }, select: { poNo: true }, distinct: ['poNo'] }),
      this.prisma.cSVMaster.findMany({ where: { poNo: { not: null } }, select: { poNo: true }, distinct: ['poNo'] }),
    ]);
    return new Set([...credit, ...vatCredit].map((r) => r.poNo).filter((p): p is string => !!p));
  }

  /**
   * Build an order's detail rows with the order-level discount already pushed
   * down onto them.
   *
   * `Discount` on the master is a percent of the VAT-inclusive total, so each
   * line's share is spread by its own VAT-inclusive value and stored on the
   * line. An order has no per-line discount, so the share is the whole of the
   * line's discount — and without it an item-level report reads the lines at
   * full price and shows the order as worth more than it was taken for.
   *
   * The form sends only item/qty/price, so VAT is priced here from the catalog
   * (the same active t_Price row the POS terminal sells at) and the resulting
   * amount/vatPrice are stored alongside — they are what the share was
   * apportioned on, so a reader can check the split without re-pricing.
   */
  private async buildOrderLines(
    items: OrderItemDto[],
    discountPercent: number | undefined,
    serialNo: string | null,
  ) {
    const vatPctById = await this.vatPercentFor(items.map((i) => i.itemId));

    const priced = items.map((item) => {
      const qty = Number(item.qty) || 0;
      const unitPrice = Number(item.unitPrice ?? 0) || 0;
      const amount = item.amount != null ? r2(Number(item.amount)) : r2(qty * unitPrice);
      const vatPrice =
        item.vatPrice != null
          ? r2(Number(item.vatPrice))
          : r2((amount * (vatPctById.get(item.itemId) ?? 0)) / 100);
      return { itemId: item.itemId, qty, unitPrice, amount, vatPrice };
    });

    const lineGross = priced.map((l) => r2(l.amount + l.vatPrice));
    const gross = r2(lineGross.reduce((s, g) => s + g, 0));
    const pct = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
    const orderDiscount = Math.min(r2((gross * pct) / 100), gross);
    const shares = allocateDiscount(lineGross, orderDiscount);

    return priced.map((l, i) => ({
      itemId: l.itemId,
      qty: l.qty,
      unitPrice: l.unitPrice,
      vatPrice: l.vatPrice,
      amount: l.amount,
      discount: shares[i],
      serialNo,
    }));
  }

  /** VAT rate per item id, from the active price row. Items with no active
   *  price fall out of the map and are treated as 0% — an order is a quote, not
   *  a sale, so a missing price must not block taking it. */
  private async vatPercentFor(itemIds: string[]): Promise<Map<string, number>> {
    const ids = [...new Set(itemIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await this.prisma.item_Information.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        prices: {
          where: { priceIsActive: 1 },
          orderBy: { priceFromDate: 'desc' },
          select: { priceVatPercent: true },
          take: 1,
        },
      },
    });
    return new Map(rows.map((r) => [r.id, Number(r.prices[0]?.priceVatPercent ?? 0)]));
  }

  async create(dto: CreateOrderDto, createdBy: string, userBranchId?: string) {
    const branchId = dto.branchId ?? userBranchId;
    const serialNo = dto.serialNo || (await this.generateSerialNo('ORD', branchId));
    return this.prisma.orderReceive_Master.create({
      data: {
        clientId: dto.clientId,
        serialNo,
        advance: dto.advance,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(),
        totalPrice: dto.totalPrice,
        discount: dto.discount,
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
        deliveryAddress: dto.deliveryAddress,
        cType: dto.cType,
        branchId,
        deliveryTime: dto.deliveryTime ? new Date(dto.deliveryTime) : undefined,
        isActive: 1,
        createBy: createdBy,
        createDate: new Date(),
        details: { create: await this.buildOrderLines(dto.items, dto.discount, serialNo) },
      },
      include: { details: true },
    });
  }

  async update(id: string, dto: Partial<CreateOrderDto>, updatedBy: string, accessibleBranchIds?: string[]) {
    const existing = await this.findOne(id, accessibleBranchIds);
    const { items, orderDate, deliveryDate, deliveryTime, ...rest } = dto;
    // The replacement lines carry the discount too, and at whatever rate the
    // edit set — an amended order that kept the old lines' shares would net out
    // to a different total than the one the form showed.
    const discount = dto.discount ?? Number(existing.discount ?? 0);
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
            create: await this.buildOrderLines(items, discount, existing.serialNo),
          },
        }),
      },
      include: { details: true },
    });
  }

  async remove(id: string, accessibleBranchIds?: string[]) {
    await this.findOne(id, accessibleBranchIds);
    await this.prisma.$transaction([
      this.prisma.orderReceive_Detail.deleteMany({ where: { masterId: id } }),
      this.prisma.orderReceive_Master.delete({ where: { id } }),
    ]);
    return { message: 'Order deleted successfully' };
  }

  // ── VAT Orders ────────────────────────────────────────────────

  async findAllVat(query: BranchPaginationQueryDto, accessibleBranchIds?: string[]) {
    const { page, limit, branchId } = query;
    const where = branchScope(accessibleBranchIds, ['branchId'], branchId);
    const [rows, total] = await Promise.all([
      this.prisma.vOrderReceive_Master.findMany({ where, include: { details: true }, orderBy: { orderDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.vOrderReceive_Master.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async createVat(dto: CreateVatOrderDto, createdBy: string) {
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
