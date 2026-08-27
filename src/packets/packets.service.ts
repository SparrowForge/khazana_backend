import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { IsString, IsOptional, IsNumber, IsInt } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto, DateRangeQueryDto, dateRangeFilter } from '../common/dto';
import { buildPaginationMeta, branchScope, canAccessBranch, toBranchUuid } from '../common/helpers';
import {
  CreatePacketReceiveDto, UpdatePacketReceiveDto,
  CreatePacketIssueDto, UpdatePacketIssueDto,
  PacketLineDto, PacketStockQueryDto,
} from './dto/packet-document.dto';

/** Packet codes are system-generated as P001, P002, ... — never typed by staff. */
const CODE_PREFIX = 'P';
const CODE_PAD = 3;
const CODE_RE = new RegExp(`^${CODE_PREFIX}(\\d+)$`, 'i');

export class CreatePacketDto {
  /** Optional: left blank the server generates the next P### code. */
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  uom?: string;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsNumber()
  @IsOptional()
  rate?: number;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsInt()
  @IsOptional()
  isActive?: number;
}

/**
 * Update deliberately has NO `code` field: the code is the row's business key
 * (Packet_Receive/Packet_Issue reference it) and is system-generated, so it can
 * never be re-keyed by an edit. Declaring a real class rather than
 * `Partial<CreatePacketDto>` matters — a mapped type erases to `Object` at
 * runtime, which makes the global ValidationPipe skip the body entirely and
 * pass unknown fields straight through to Prisma.
 */
export class UpdatePacketDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  uom?: string;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsNumber()
  @IsOptional()
  rate?: number;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsInt()
  @IsOptional()
  isActive?: number;
}

/** Extra fields `groupBySerial` adds to the row it keeps for each document. */
interface SerialGroupRow {
  serialNo: string;
  qty: number;
  lineCount: number;
}

/**
 * Packets — the boxes and bags stock is packed into.
 *
 * Three related things live here:
 *  - **PacketInfo**: the catalogue, keyed by a system-generated `P###` code.
 *  - **Packet Receive / Packet Issue**: branch-scoped documents, shaped after
 *    ProductionService — one serial number per document, every packet line
 *    sharing it, purge-and-replace on edit.
 *  - **Packet Stock**: the register those two tables imply. Packets are NOT in
 *    the `Inventory` table (that is itemCode-keyed for Item_Information), so a
 *    packet balance is always *derived*: receives minus issues, per branch.
 *
 * Because the balance is derived rather than stored there is nothing to keep in
 * sync, but it does mean every write has to re-derive it to refuse going
 * negative — see `assertPacketBalance`.
 */
@Injectable()
export class PacketsService {
  constructor(private prisma: PrismaService) {}

  private static readonly RECEIVE_PREFIX = 'PKR';
  private static readonly ISSUE_PREFIX = 'PKI';

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  // ── PacketInfo catalogue ──────────────────────────────────────

  async findAll(query: PaginationQueryDto) {
    const { page, limit } = query;
    const where = { isActive: 1 };
    const [packets, total] = await Promise.all([
      this.prisma.packetInfo.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.packetInfo.count({ where }),
    ]);
    return { items: packets, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(code: string) {
    const packet = await this.prisma.packetInfo.findUnique({ where: { code } });
    if (!packet) throw new NotFoundException('Packet not found');
    return packet;
  }

  /** Next free packet code — P001 on an empty table, then P002, P003, ...
   *  Scans every existing code (including deactivated ones) so a soft-deleted
   *  packet's code is never handed out again. */
  async getNextCode() {
    const existing = await this.prisma.packetInfo.findMany({ select: { code: true } });
    const maxSeq = existing.reduce((max, { code }) => {
      const match = code?.match(CODE_RE);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return { code: `${CODE_PREFIX}${String(maxSeq + 1).padStart(CODE_PAD, '0')}` };
  }

  async create(dto: CreatePacketDto, createdBy: string) {
    const { code: requestedCode, ...fields } = dto;
    const code = requestedCode?.trim() || (await this.getNextCode()).code;

    try {
      return await this.prisma.packetInfo.create({
        data: { ...fields, code, isActive: dto.isActive ?? 1, createBy: createdBy, createDate: new Date() },
      });
    } catch (err) {
      // Two people saving at once can race for the same generated code. The
      // client cannot fix a code it never chose, so re-generate and retry once.
      const isDuplicate = (err as { code?: string })?.code === 'P2002';
      if (!isDuplicate || requestedCode?.trim()) throw err;
      const retry = (await this.getNextCode()).code;
      return this.prisma.packetInfo.create({
        data: { ...fields, code: retry, isActive: dto.isActive ?? 1, createBy: createdBy, createDate: new Date() },
      });
    }
  }

  async update(code: string, dto: UpdatePacketDto, updatedBy: string) {
    await this.findOne(code);
    return this.prisma.packetInfo.update({
      where: { code },
      data: { ...dto, updateBy: updatedBy, updateDate: new Date() },
    });
  }

  async remove(code: string, updatedBy: string) {
    await this.findOne(code);
    // Soft delete: packets are referenced by receive/issue history, so deactivate
    await this.prisma.packetInfo.update({
      where: { code },
      data: { isActive: 0, updateBy: updatedBy, updateDate: new Date() },
    });
    return { message: 'Packet deleted successfully' };
  }

  // ── Shared document plumbing ──────────────────────────────────

  private buildSerialNo(prefix: string, branchCode: string, seq: number): string {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const code = (branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return [prefix, code, yyyymm, String(seq).padStart(5, '0')].filter(Boolean).join('-');
  }

  /** Resolve the session branch to a real Branch row so its code can go into the
   *  serial number. Falls back to the default branch the same way every other
   *  branch-aware write does — the branch columns are NOT NULL. */
  private async resolveBranch(sessionBranchId?: string | null) {
    const id = toBranchUuid(sessionBranchId);
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      select: { id: true, branchCode: true, branchName: true, address: true },
    });
    if (!branch) throw new BadRequestException('Session branch could not be resolved');
    return branch;
  }

  /** Rows sharing one serialNo were written by the same request, so the header
   *  fields are identical — only the packet line differs. Collapse them to one
   *  list row carrying the summed qty. */
  private groupBySerial<T extends { serialNo?: string | null; id: string; qty?: unknown }>(
    rows: T[], page: number, limit: number,
  ) {
    const groups = new Map<string, T & SerialGroupRow>();
    for (const row of rows) {
      const key = row.serialNo || row.id;
      const qty = Number(row.qty ?? 0);
      const existing = groups.get(key);
      if (existing) {
        existing.qty += qty;
        existing.lineCount += 1;
      } else {
        groups.set(key, { ...row, serialNo: key, qty, lineCount: 1 });
      }
    }
    const all = Array.from(groups.values());
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit), meta: buildPaginationMeta(all.length, page, limit) };
  }

  /** Merge repeated lines for the same packet into one, and reject an empty or
   *  unknown set. A document that lists P001 twice is one line of the total. */
  private async normaliseLines(items: PacketLineDto[]): Promise<PacketLineDto[]> {
    if (!items?.length) throw new BadRequestException('Add at least one packet line');

    const merged = new Map<string, number>();
    for (const line of items) {
      const code = line.code?.trim();
      if (!code) throw new BadRequestException('Every line needs a packet code');
      merged.set(code, (merged.get(code) ?? 0) + Number(line.qty ?? 0));
    }

    const codes = [...merged.keys()];
    const known = await this.prisma.packetInfo.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });
    const knownCodes = new Set(known.map((k) => k.code));
    const missing = codes.filter((c) => !knownCodes.has(c));
    if (missing.length) throw new BadRequestException(`Unknown packet code(s): ${missing.join(', ')}`);

    return codes.map((code) => ({ code, qty: merged.get(code)! }));
  }

  /**
   * Refuse any write that would drive a packet's branch balance negative.
   *
   * `delta` is the net change the request applies per code — positive for a
   * receive, negative for an issue. Rows belonging to the document being
   * replaced are skipped, so an edit is measured against a world where that
   * document does not exist yet and is then re-applied through `delta`.
   *
   * The stored rows are read in full and the document's own ones skipped in
   * memory, rather than filtered out with a `NOT` clause: both tables allow a
   * null `serialNo`, and a negated equality is an awkward shape to reason about
   * against nulls. Reading them is cheap — a branch's packet movement is small.
   */
  private async assertPacketBalance(
    tx: Pick<PrismaService, 'packet_Receive' | 'packet_Issue'>,
    branchId: string,
    delta: Map<string, number>,
    exclude: { receiveSerial?: string | null; issueSerial?: string | null } = {},
  ) {
    const codes = [...delta.keys()];
    if (!codes.length) return;

    const [receives, issues] = await Promise.all([
      tx.packet_Receive.findMany({
        where: { isActive: 1, branchId, code: { in: codes } },
        select: { code: true, qty: true, serialNo: true },
      }),
      tx.packet_Issue.findMany({
        where: { isActive: 1, branchId, code: { in: codes } },
        select: { code: true, qty: true, serialNo: true },
      }),
    ]);

    const balance = new Map<string, number>(codes.map((c) => [c, 0]));
    const add = (code: string | null, amount: number) => {
      if (code && balance.has(code)) balance.set(code, balance.get(code)! + amount);
    };
    for (const r of receives) {
      if (exclude.receiveSerial && r.serialNo === exclude.receiveSerial) continue;
      add(r.code, Number(r.qty ?? 0));
    }
    for (const i of issues) {
      if (exclude.issueSerial && i.serialNo === exclude.issueSerial) continue;
      add(i.code, -Number(i.qty ?? 0));
    }

    const short = codes
      .map((code) => ({ code, available: balance.get(code)!, after: balance.get(code)! + (delta.get(code) ?? 0) }))
      .filter((r) => r.after < 0);

    if (short.length) {
      const detail = short
        .map((s) => `${s.code} (available ${s.available}, short by ${Math.abs(s.after)})`)
        .join('; ');
      throw new BadRequestException(`Not enough packet stock at this branch: ${detail}`);
    }
  }

  private async packetNamesByCode(codes: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.packetInfo.findMany({
      where: { code: { in: [...new Set(codes)] } },
      select: { code: true, name: true },
    });
    return new Map(rows.map((r) => [r.code, r.name ?? '']));
  }

  // ── Packet Receive ────────────────────────────────────────────

  async findAllReceives(query: DateRangeQueryDto, accessibleBranchIds?: string[]) {
    const { page, limit, branchId, fromDate, toDate } = query;
    const receiveDate = dateRangeFilter(fromDate, toDate);
    const rows = await this.prisma.packet_Receive.findMany({
      where: {
        isActive: 1,
        ...branchScope(accessibleBranchIds, ['branchId'], branchId),
        ...(receiveDate && { receiveDate }),
      },
      orderBy: { createDate: 'desc' },
    });
    return this.groupBySerial(rows, page, limit);
  }

  /** Looks up receive rows by serialNo, falling back to a single row by id for
   *  any record written before serial numbers existed. */
  private async findReceiveRows(serialNo: string) {
    let rows = await this.prisma.packet_Receive.findMany({ where: { serialNo }, orderBy: { createDate: 'asc' } });
    if (!rows.length && this.isUuid(serialNo)) {
      const fallback = await this.prisma.packet_Receive.findUnique({ where: { id: serialNo } });
      if (fallback) rows = [fallback];
    }
    if (!rows.length) throw new NotFoundException('Packet receive entry not found');
    return rows;
  }

  async findOneReceive(serialNo: string, accessibleBranchIds?: string[]) {
    const rows = await this.findReceiveRows(serialNo);
    const [first] = rows;
    if (!canAccessBranch(accessibleBranchIds, first.branchId)) {
      throw new ForbiddenException('This packet receive entry belongs to another branch');
    }
    const nameByCode = await this.packetNamesByCode(rows.map((r) => r.code ?? ''));
    const branch = await this.prisma.branch.findUnique({
      where: { id: first.branchId },
      select: { branchName: true, address: true },
    });

    return {
      serialNo: first.serialNo || first.id,
      voucharNo: first.voucharNo,
      receiveDate: first.receiveDate,
      branchId: first.branchId,
      branchName: branch?.branchName,
      branchAddress: branch?.address ?? undefined,
      items: rows.map((r) => ({
        code: r.code,
        name: r.code ? nameByCode.get(r.code) : undefined,
        qty: Number(r.qty ?? 0),
      })),
    };
  }

  async createReceive(dto: CreatePacketReceiveDto, createdBy: string, sessionBranchId: string) {
    const lines = await this.normaliseLines(dto.items);
    const branch = await this.resolveBranch(sessionBranchId);
    const receiveDate = new Date(dto.receiveDate);
    const baseCount = await this.prisma.packet_Receive.count();
    // Every line in this request shares one serial number so the whole document
    // can be looked up / edited / deleted together later.
    const serialNo =
      dto.serialNo?.trim() ||
      this.buildSerialNo(PacketsService.RECEIVE_PREFIX, branch.branchCode ?? '', baseCount + 1);

    return this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const line of lines) {
        created.push(
          await tx.packet_Receive.create({
            data: {
              serialNo,
              voucharNo: dto.voucharNo,
              code: line.code,
              qty: line.qty,
              receiveDate,
              branchId: branch.id,
              isActive: 1,
              createBy: createdBy,
              createDate: new Date(),
            },
          }),
        );
      }
      return created;
    });
  }

  async updateReceive(
    serialNo: string, dto: UpdatePacketReceiveDto, updatedBy: string,
    sessionBranchId: string, accessibleBranchIds?: string[],
  ) {
    const lines = await this.normaliseLines(dto.items);
    const existing = await this.findReceiveRows(serialNo);
    const first = existing[0];
    if (!canAccessBranch(accessibleBranchIds, first.branchId)) {
      throw new ForbiddenException('This packet receive entry belongs to another branch');
    }
    const key = first.serialNo || first.id;
    const branchId = first.branchId ?? (await this.resolveBranch(sessionBranchId)).id;
    const receiveDate = new Date(dto.receiveDate);
    const where = first.serialNo ? { serialNo: key } : { id: first.id };

    return this.prisma.$transaction(async (tx) => {
      // Purge-and-replace, so the balance is checked against the net movement:
      // what the new lines bring in, against what the old lines take back out.
      // Reducing a receipt whose packets have already been issued is the case
      // this refuses.
      const delta = new Map<string, number>();
      for (const row of existing) {
        if (row.code) delta.set(row.code, (delta.get(row.code) ?? 0) - Number(row.qty ?? 0));
      }
      for (const line of lines) {
        delta.set(line.code, (delta.get(line.code) ?? 0) + line.qty);
      }
      await this.assertPacketBalance(tx, branchId, delta, { receiveSerial: first.serialNo ? key : null });

      await tx.packet_Receive.deleteMany({ where });

      const rewritten = [];
      for (const line of lines) {
        rewritten.push(
          await tx.packet_Receive.create({
            data: {
              serialNo: key,
              voucharNo: dto.voucharNo,
              code: line.code,
              qty: line.qty,
              receiveDate,
              branchId,
              isActive: 1,
              // Packet_Receive has no updateBy/updateDate columns, so the
              // original author is preserved and the edit is traced through the
              // audit log instead.
              createBy: first.createBy ?? updatedBy,
              createDate: first.createDate ?? new Date(),
            },
          }),
        );
      }
      return rewritten;
    });
  }

  async removeReceive(serialNo: string, accessibleBranchIds?: string[]) {
    const existing = await this.findReceiveRows(serialNo);
    const first = existing[0];
    if (!canAccessBranch(accessibleBranchIds, first.branchId)) {
      throw new ForbiddenException('This packet receive entry belongs to another branch');
    }
    const key = first.serialNo || first.id;
    const where = first.serialNo ? { serialNo: key } : { id: first.id };

    await this.prisma.$transaction(async (tx) => {
      // Deleting withdraws what this entry brought in; refuse if those packets
      // have already gone out again.
      const delta = new Map<string, number>();
      for (const row of existing) {
        if (row.code) delta.set(row.code, (delta.get(row.code) ?? 0) - Number(row.qty ?? 0));
      }
      await this.assertPacketBalance(tx, first.branchId, delta, { receiveSerial: first.serialNo ? key : null });
      await tx.packet_Receive.deleteMany({ where });
    });
    return { message: 'Packet receive entry deleted successfully' };
  }

  // ── Packet Issue ──────────────────────────────────────────────

  async findAllIssues(query: DateRangeQueryDto, accessibleBranchIds?: string[]) {
    const { page, limit, branchId, fromDate, toDate } = query;
    const issueDate = dateRangeFilter(fromDate, toDate);
    const rows = await this.prisma.packet_Issue.findMany({
      where: {
        isActive: 1,
        ...branchScope(accessibleBranchIds, ['branchId'], branchId),
        ...(issueDate && { issueDate }),
      },
      orderBy: { createDate: 'desc' },
    });
    return this.groupBySerial(rows, page, limit);
  }

  private async findIssueRows(serialNo: string) {
    let rows = await this.prisma.packet_Issue.findMany({ where: { serialNo }, orderBy: { createDate: 'asc' } });
    if (!rows.length && this.isUuid(serialNo)) {
      const fallback = await this.prisma.packet_Issue.findUnique({ where: { id: serialNo } });
      if (fallback) rows = [fallback];
    }
    if (!rows.length) throw new NotFoundException('Packet issue entry not found');
    return rows;
  }

  async findOneIssue(serialNo: string, accessibleBranchIds?: string[]) {
    const rows = await this.findIssueRows(serialNo);
    const [first] = rows;
    if (!canAccessBranch(accessibleBranchIds, first.branchId)) {
      throw new ForbiddenException('This packet issue entry belongs to another branch');
    }
    const nameByCode = await this.packetNamesByCode(rows.map((r) => r.code ?? ''));
    const branch = await this.prisma.branch.findUnique({
      where: { id: first.branchId },
      select: { branchName: true, address: true },
    });

    return {
      serialNo: first.serialNo || first.id,
      invoiceNo: first.invoiceNo,
      issueType: first.issueType,
      issueDate: first.issueDate,
      branchId: first.branchId,
      branchName: branch?.branchName,
      branchAddress: branch?.address ?? undefined,
      items: rows.map((r) => ({
        code: r.code,
        name: r.code ? nameByCode.get(r.code) : undefined,
        qty: Number(r.qty ?? 0),
      })),
    };
  }

  async createIssue(dto: CreatePacketIssueDto, createdBy: string, sessionBranchId: string) {
    const lines = await this.normaliseLines(dto.items);
    const branch = await this.resolveBranch(sessionBranchId);
    const issueDate = new Date(dto.issueDate);
    const baseCount = await this.prisma.packet_Issue.count();
    const serialNo =
      dto.serialNo?.trim() ||
      this.buildSerialNo(PacketsService.ISSUE_PREFIX, branch.branchCode ?? '', baseCount + 1);

    return this.prisma.$transaction(async (tx) => {
      const delta = new Map<string, number>(lines.map((l) => [l.code, -l.qty]));
      await this.assertPacketBalance(tx, branch.id, delta);

      const created = [];
      for (const line of lines) {
        created.push(
          await tx.packet_Issue.create({
            data: {
              serialNo,
              invoiceNo: dto.invoiceNo,
              issueType: dto.issueType,
              code: line.code,
              qty: line.qty,
              issueDate,
              branchId: branch.id,
              isActive: 1,
              createBy: createdBy,
              createDate: new Date(),
            },
          }),
        );
      }
      return created;
    });
  }

  async updateIssue(
    serialNo: string, dto: UpdatePacketIssueDto, updatedBy: string,
    sessionBranchId: string, accessibleBranchIds?: string[],
  ) {
    const lines = await this.normaliseLines(dto.items);
    const existing = await this.findIssueRows(serialNo);
    const first = existing[0];
    if (!canAccessBranch(accessibleBranchIds, first.branchId)) {
      throw new ForbiddenException('This packet issue entry belongs to another branch');
    }
    const key = first.serialNo || first.id;
    const branchId = first.branchId ?? (await this.resolveBranch(sessionBranchId)).id;
    const issueDate = new Date(dto.issueDate);
    const where = first.serialNo ? { serialNo: key } : { id: first.id };

    return this.prisma.$transaction(async (tx) => {
      // Net movement: the old lines are given back, the new ones taken out.
      const delta = new Map<string, number>();
      for (const row of existing) {
        if (row.code) delta.set(row.code, (delta.get(row.code) ?? 0) + Number(row.qty ?? 0));
      }
      for (const line of lines) {
        delta.set(line.code, (delta.get(line.code) ?? 0) - line.qty);
      }
      await this.assertPacketBalance(tx, branchId, delta, { issueSerial: first.serialNo ? key : null });

      await tx.packet_Issue.deleteMany({ where });

      const rewritten = [];
      for (const line of lines) {
        rewritten.push(
          await tx.packet_Issue.create({
            data: {
              serialNo: key,
              invoiceNo: dto.invoiceNo,
              issueType: dto.issueType,
              code: line.code,
              qty: line.qty,
              issueDate,
              branchId,
              isActive: 1,
              createBy: first.createBy ?? updatedBy,
              createDate: first.createDate ?? new Date(),
              updateBy: updatedBy,
              updateDate: new Date(),
            },
          }),
        );
      }
      return rewritten;
    });
  }

  async removeIssue(serialNo: string, accessibleBranchIds?: string[]) {
    const existing = await this.findIssueRows(serialNo);
    const first = existing[0];
    if (!canAccessBranch(accessibleBranchIds, first.branchId)) {
      throw new ForbiddenException('This packet issue entry belongs to another branch');
    }
    const key = first.serialNo || first.id;
    // Deleting an issue only ever gives stock back, so there is no balance to
    // guard here the way there is on a receive.
    await this.prisma.packet_Issue.deleteMany({ where: first.serialNo ? { serialNo: key } : { id: first.id } });
    return { message: 'Packet issue entry deleted successfully' };
  }

  // ── Packet Stock register ─────────────────────────────────────

  /**
   * The packet stock register for a branch and a date window.
   *
   * Movement strictly before `fromDate` is folded into `opening`; movement
   * inside `[fromDate, toDate]` becomes `received` / `issued`; `balance` is
   * `opening + received - issued`, which is the closing balance as at `toDate`
   * rather than an all-time total. Anything after `toDate` is excluded from all
   * four columns — the sheet is a snapshot of that window, not of today.
   *
   * Rows come from PacketInfo, not from the movement tables: a packet received
   * last month with no movement this month still has an opening balance to
   * report, and keying off receives alone (as this once did) made it disappear
   * — as it did any packet that had only ever been issued.
   */
  async getPacketStock(query: PacketStockQueryDto, accessibleBranchIds?: string[]) {
    const { code, branchId, fromDate, toDate, includeEmpty } = query;

    const scope = branchScope(accessibleBranchIds, ['branchId'], branchId);
    const openingBound = fromDate ? new Date(fromDate) : undefined;
    if (openingBound && isNaN(openingBound.getTime())) throw new BadRequestException('Invalid fromDate');
    const periodRange = dateRangeFilter(fromDate, toDate);

    const packets = await this.prisma.packetInfo.findMany({
      where: { isActive: 1, ...(code && { code }) },
      orderBy: { code: 'asc' },
      select: { code: true, name: true, uom: true, rate: true },
    });
    const codes = packets.map((p) => p.code);
    const emptyTotals = { opening: 0, received: 0, issued: 0, balance: 0 };
    if (!codes.length) {
      return { fromDate, toDate, branchId, items: [], totals: emptyTotals };
    }

    const [receives, issues] = await Promise.all([
      this.prisma.packet_Receive.findMany({
        where: { isActive: 1, code: { in: codes }, ...scope },
        select: { code: true, qty: true, receiveDate: true },
      }),
      this.prisma.packet_Issue.findMany({
        where: { isActive: 1, code: { in: codes }, ...scope },
        select: { code: true, qty: true, issueDate: true },
      }),
    ]);

    const byCode = new Map(codes.map((c) => [c, { opening: 0, received: 0, issued: 0 }]));

    /** Which bucket a movement falls in. A row with no date at all counts as
     *  opening: it predates the period in every sense that matters here. */
    const bucket = (date: Date | null): 'opening' | 'period' | 'after' => {
      if (!date) return 'opening';
      if (periodRange?.gte && date < periodRange.gte) return 'opening';
      if (periodRange?.lte && date > periodRange.lte) return 'after';
      return 'period';
    };

    for (const r of receives) {
      const row = r.code ? byCode.get(r.code) : undefined;
      if (!row) continue;
      const where = bucket(r.receiveDate);
      if (where === 'opening') row.opening += Number(r.qty ?? 0);
      else if (where === 'period') row.received += Number(r.qty ?? 0);
    }
    for (const i of issues) {
      const row = i.code ? byCode.get(i.code) : undefined;
      if (!row) continue;
      const where = bucket(i.issueDate);
      if (where === 'opening') row.opening -= Number(i.qty ?? 0);
      else if (where === 'period') row.issued += Number(i.qty ?? 0);
    }

    const items = packets
      .map((p) => {
        const m = byCode.get(p.code)!;
        return {
          code: p.code,
          name: p.name,
          uom: p.uom,
          rate: p.rate ? Number(p.rate) : 0,
          opening: m.opening,
          received: m.received,
          issued: m.issued,
          balance: m.opening + m.received - m.issued,
        };
      })
      // A packet with nothing to say in this window is noise on a stock sheet,
      // so it is dropped unless the caller asks for the whole catalogue.
      .filter((r) => includeEmpty === 1 || r.opening !== 0 || r.received !== 0 || r.issued !== 0);

    const totals = items.reduce(
      (acc, r) => ({
        opening: acc.opening + r.opening,
        received: acc.received + r.received,
        issued: acc.issued + r.issued,
        balance: acc.balance + r.balance,
      }),
      { ...emptyTotals },
    );

    return { fromDate, toDate, branchId, items, totals };
  }
}
