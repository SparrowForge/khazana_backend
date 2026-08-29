import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateVehicleChallanDto, UpdateVehicleChallanDto, VehicleChallanLineDto, VehicleChallanQueryDto } from './dto/vehicle-challan.dto';
import { dateRangeFilter } from '../common/dto';
import { buildPaginationMeta, isFactoryBranch } from '../common/helpers';

/**
 * Vehicle Challan — the gate pass for a loaded van leaving the factory.
 *
 * The factory sends a vehicle out on a route with sweets aboard; the van calls
 * at each outlet, which takes what it needs, and whatever is left comes back.
 * Nobody knows the split at loading time, so this document has NO destination
 * branch: it exists so security and the factory can account for what physically
 * went out on the vehicle.
 *
 * **It deliberately does not touch stock.** The real movement is recorded as a
 * Stock Issue when an outlet actually takes goods off the van, and decrementing
 * Inventory here as well would double-count every one of those units. That is
 * the single rule this service exists to hold: nothing below writes to
 * Inventory, and nothing below needs a stock-availability check either — the
 * goods have not left the factory's books yet.
 *
 * Shaped after ProductionService / the Stock Issue flow otherwise: one serial
 * number per document, every item line sharing it, purge-and-replace on edit.
 * Factory-only, re-checked on every mutating call so a non-factory session
 * cannot reach it by calling the API directly.
 */
@Injectable()
export class VehicleChallanService {
  constructor(private prisma: PrismaService) {}

  private static readonly SERIAL_PREFIX = 'VCH';

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  /** A vehicle challan may only be raised at the factory — the same gate
   *  Production Entry applies. Returns the branch so the caller can reuse its
   *  code for the serial number and its address for the letterhead. */
  private async assertFactoryBranch(branchId?: string | null) {
    const branch =
      branchId && this.isUuid(branchId)
        ? await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { id: true, branchCode: true, branchName: true, address: true },
          })
        : null;
    if (!isFactoryBranch(branch)) {
      throw new ForbiddenException('Vehicle Challan is available only at the Factory branch');
    }
    return branch!;
  }

  private async itemNamesByIds(ids: string[]): Promise<Map<string, { name: string; uom?: string }>> {
    const uniqueIds = [...new Set(ids)];
    const rows = await this.prisma.item_Information.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, itmName: true, itmCode: true, itmUOM: true },
    });
    return new Map(rows.map((r) => [r.id, { name: r.itmName ?? r.itmCode, uom: r.itmUOM ?? undefined }]));
  }

  /**
   * Resolve the lines to write.
   *
   * A line either points at a catalogue item or is ad-hoc — goods typed straight
   * onto the challan, which are deliberately NOT written to Item_Information.
   * Either way the description and unit are stored on the line: the ad-hoc line
   * has nowhere else to keep them, and snapshotting the catalogue line means the
   * challan still reads as it was issued after the item is renamed.
   *
   * A catalogue id is verified here rather than left to surface as an opaque FK
   * violation halfway through writing the document.
   */
  private async resolveLines(items: VehicleChallanLineDto[]) {
    const ids = [...new Set(items.map((l) => l.itemId).filter((id): id is string => !!id))];
    const catalogue = ids.length
      ? await this.prisma.item_Information.findMany({
          where: { id: { in: ids } },
          select: { id: true, itmName: true, itmCode: true, itmUOM: true },
        })
      : [];
    const byId = new Map(catalogue.map((r) => [r.id, r]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw new BadRequestException(`Unknown item id(s): ${missing.join(', ')}`);

    return items.map((line, i) => {
      const item = line.itemId ? byId.get(line.itemId)! : null;
      const itemName = (line.itemName ?? '').trim() || item?.itmName || item?.itmCode || '';
      // Nothing to print in the Description column is not a challan line.
      if (!itemName) {
        throw new BadRequestException(`Line ${i + 1}: pick an item or type a description`);
      }
      return {
        itemId: line.itemId ?? null,
        itemName,
        uom: (line.uom ?? '').trim() || item?.itmUOM || null,
        qty: line.qty,
      };
    });
  }

  private buildSerialNo(branchCode: string, seq: number): string {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const code = (branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return [VehicleChallanService.SERIAL_PREFIX, code, yyyymm, String(seq).padStart(5, '0')]
      .filter(Boolean)
      .join('-');
  }

  /** Rows sharing one serialNo were written by the same request, so the header
   *  fields are identical — only the item line differs. Collapse them to one
   *  list row carrying the summed qty. */
  private groupBySerial<T extends { serialNo?: string | null; id: string; qty?: unknown }>(
    rows: T[],
    page: number,
    limit: number,
  ) {
    const groups = new Map<string, T & { serialNo: string; qty: number; lines: number }>();
    for (const row of rows) {
      const key = row.serialNo || row.id;
      const existing = groups.get(key);
      if (existing) {
        existing.qty += Number(row.qty ?? 0);
        existing.lines += 1;
      } else {
        groups.set(key, { ...row, serialNo: key, qty: Number(row.qty ?? 0), lines: 1 });
      }
    }
    const all = Array.from(groups.values());
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit), meta: buildPaginationMeta(all.length, page, limit) };
  }

  /** Looks up challan rows by serialNo, falling back to a single row by id for
   *  any record whose serialNo was left blank. */
  private async findRows(serialNo: string) {
    let rows = await this.prisma.vehicle_Challan.findMany({
      where: { serialNo },
      orderBy: { createDate: 'asc' },
    });
    if (!rows.length && this.isUuid(serialNo)) {
      const fallback = await this.prisma.vehicle_Challan.findUnique({ where: { id: serialNo } });
      if (fallback) rows = [fallback];
    }
    if (!rows.length) throw new NotFoundException('Vehicle challan not found');
    return rows;
  }

  // ── Create ────────────────────────────────────────────────────

  async create(dto: CreateVehicleChallanDto, createdBy: string, sessionBranchId: string) {
    if (!dto.items?.length) throw new BadRequestException('No items on this challan');
    const branch = await this.assertFactoryBranch(sessionBranchId);
    const lines = await this.resolveLines(dto.items);

    const challanDate = new Date(dto.challanDate);
    const baseCount = await this.prisma.vehicle_Challan.count();
    // Every line in this request shares one serial number so the whole document
    // can be looked up / edited / deleted together later.
    const serialNo = dto.serialNo || this.buildSerialNo(branch.branchCode ?? '', baseCount + 1);

    // One transaction, but no Inventory writes anywhere inside it — see the
    // class comment. Loading a van is not a stock movement.
    await this.prisma.$transaction(
      lines.map((line) =>
        this.prisma.vehicle_Challan.create({
          data: {
            serialNo,
            branchId: branch.id,
            challanDate,
            itemId: line.itemId,
            itemName: line.itemName,
            uom: line.uom,
            qty: line.qty,
            customerName: dto.customerName,
            customerAddress: dto.customerAddress,
            deliveryAddress: dto.deliveryAddress,
            contactPerson: dto.contactPerson,
            contactNo: dto.contactNo,
            poNo: dto.poNo,
            poDate: dto.poDate ? new Date(dto.poDate) : null,
            route: dto.route,
            vehicleNo: dto.vehicleNo,
            driverName: dto.driverName,
            driverMobile: dto.driverMobile,
            // Column keeps the legacy misspelling; the API field does not.
            voucharNo: dto.voucherNo,
            remarks: dto.remarks,
            isActive: 1,
            createBy: createdBy,
            createDate: new Date(),
          },
        }),
      ),
    );

    // The caller prints straight after saving, so hand back the whole document
    // rather than the raw rows.
    return this.findOne(serialNo);
  }

  // ── Read ──────────────────────────────────────────────────────

  async findAll(query: VehicleChallanQueryDto) {
    const { page, limit, branchId, fromDate, toDate, customerName } = query;
    const challanDate = dateRangeFilter(fromDate, toDate);
    // Matched on the line rows, before grouping: every line of a challan carries
    // the same header, so a partial match either keeps the whole document or
    // drops it — a serial can never come back with some of its lines missing.
    const customer = customerName?.trim();
    const rows = await this.prisma.vehicle_Challan.findMany({
      where: {
        isActive: 1,
        ...(branchId && { branchId }),
        ...(challanDate && { challanDate }),
        ...(customer && { customerName: { contains: customer, mode: 'insensitive' as const } }),
      },
      orderBy: { createDate: 'desc' },
    });
    return this.groupBySerial(rows, page, limit);
  }

  async findOne(serialNo: string) {
    const rows = await this.findRows(serialNo);
    const [first] = rows;
    // Only needed for rows written before ItemName existed; everything since
    // carries its own description.
    const itemById = await this.itemNamesByIds(
      rows.filter((r) => !r.itemName).map((r) => r.itemId).filter((id): id is string => !!id),
    );

    const branch = first.branchId
      ? await this.prisma.branch.findUnique({
          where: { id: first.branchId },
          // vatNo/mobileNo head the printed challan alongside the address.
          select: { branchName: true, address: true, vatNo: true, mobileNo: true },
        })
      : null;

    return {
      serialNo: first.serialNo || first.id,
      voucherNo: first.voucharNo,
      challanDate: first.challanDate,
      branchId: first.branchId,
      branchName: branch?.branchName ?? undefined,
      branchAddress: branch?.address ?? undefined,
      branchVatNo: branch?.vatNo ?? undefined,
      branchMobileNo: branch?.mobileNo ?? undefined,
      customerName: first.customerName,
      customerAddress: first.customerAddress,
      deliveryAddress: first.deliveryAddress,
      contactPerson: first.contactPerson,
      contactNo: first.contactNo,
      poNo: first.poNo,
      poDate: first.poDate,
      route: first.route,
      vehicleNo: first.vehicleNo,
      driverName: first.driverName,
      driverMobile: first.driverMobile,
      remarks: first.remarks,
      items: rows.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName ?? (r.itemId ? itemById.get(r.itemId)?.name : undefined),
        uom: r.uom ?? (r.itemId ? itemById.get(r.itemId)?.uom : undefined),
        qty: Number(r.qty ?? 0),
      })),
    };
  }

  // ── Update ────────────────────────────────────────────────────

  async update(serialNo: string, dto: UpdateVehicleChallanDto, updatedBy: string, sessionBranchId: string) {
    if (!dto.items?.length) throw new BadRequestException('No items on this challan');
    const branch = await this.assertFactoryBranch(sessionBranchId);
    const existing = await this.findRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    const lines = await this.resolveLines(dto.items);

    const challanDate = new Date(dto.challanDate);

    // Purge-and-replace, as everywhere else that groups lines under a serial.
    // Nothing has to be given back to Inventory first, because nothing was ever
    // taken from it.
    await this.prisma.$transaction([
      this.prisma.vehicle_Challan.deleteMany({ where: { serialNo: key } }),
      ...lines.map((line) =>
        this.prisma.vehicle_Challan.create({
          data: {
            serialNo: key,
            branchId: existing[0].branchId ?? branch.id,
            challanDate,
            itemId: line.itemId,
            itemName: line.itemName,
            uom: line.uom,
            qty: line.qty,
            customerName: dto.customerName,
            customerAddress: dto.customerAddress,
            deliveryAddress: dto.deliveryAddress,
            contactPerson: dto.contactPerson,
            contactNo: dto.contactNo,
            poNo: dto.poNo,
            poDate: dto.poDate ? new Date(dto.poDate) : null,
            route: dto.route,
            vehicleNo: dto.vehicleNo,
            driverName: dto.driverName,
            driverMobile: dto.driverMobile,
            voucharNo: dto.voucherNo,
            remarks: dto.remarks,
            isActive: 1,
            createBy: existing[0].createBy,
            createDate: existing[0].createDate,
            updateBy: updatedBy,
            updateDate: new Date(),
          },
        }),
      ),
    ]);

    return this.findOne(key);
  }

  // ── Delete ────────────────────────────────────────────────────

  async remove(serialNo: string, sessionBranchId: string) {
    await this.assertFactoryBranch(sessionBranchId);
    const existing = await this.findRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    await this.prisma.vehicle_Challan.deleteMany({ where: { serialNo: key } });
    return { message: 'Vehicle challan deleted successfully' };
  }
}
