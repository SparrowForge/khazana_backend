import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export class CreatePacketDto {
  code: string;
  name?: string;
  uom?: string;
  weight?: number;
  rate?: number;
  remarks?: string;
}

@Injectable()
export class PacketsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.packetInfo.findMany({ where: { isActive: 1 }, orderBy: { name: 'asc' } });
  }

  async findOne(code: string) {
    const packet = await this.prisma.packetInfo.findUnique({ where: { code } });
    if (!packet) throw new NotFoundException('Packet not found');
    return packet;
  }

  create(dto: CreatePacketDto, createdBy: string) {
    return this.prisma.packetInfo.create({
      data: { ...dto, isActive: 1, createBy: createdBy, createDate: new Date() },
    });
  }

  async update(code: string, dto: Partial<CreatePacketDto>, updatedBy: string) {
    await this.findOne(code);
    return this.prisma.packetInfo.update({
      where: { code },
      data: { ...dto, updateBy: updatedBy, updateDate: new Date() },
    });
  }

  receivePacket(dto: {
    code: string; qty: number; receiveDate: string; branchId: number;
    serialNo?: string; voucharNo?: string; createBy: string;
  }) {
    return this.prisma.packet_Receive.create({
      data: {
        code: dto.code,
        qty: dto.qty,
        receiveDate: new Date(dto.receiveDate),
        branchId: dto.branchId,
        serialNo: dto.serialNo,
        voucharNo: dto.voucharNo,
        isActive: 1,
        createBy: dto.createBy,
        createDate: new Date(),
      },
    });
  }

  issuePacket(dto: {
    code: string; qty: number; issueDate: string; branchId: number;
    issueType?: string; invoiceNo?: string; createBy: string;
  }) {
    return this.prisma.packet_Issue.create({
      data: {
        code: dto.code,
        qty: dto.qty,
        issueDate: new Date(dto.issueDate),
        branchId: dto.branchId,
        issueType: dto.issueType,
        invoiceNo: dto.invoiceNo,
        isActive: 1,
        createBy: dto.createBy,
        createDate: new Date(),
      },
    });
  }

  async getPacketStock(code?: string) {
    const receives = await this.prisma.packet_Receive.groupBy({
      by: ['code'],
      where: { isActive: 1, ...(code && { code }) },
      _sum: { qty: true },
      orderBy: { code: 'asc' },
    });
    const issues = await this.prisma.packet_Issue.groupBy({
      by: ['code'],
      where: { isActive: 1, ...(code && { code }) },
      _sum: { qty: true },
      orderBy: { code: 'asc' },
    });

    return receives.map((r) => {
      const issued = issues.find((i) => i.code === r.code)?._sum.qty ?? 0;
      return {
        code: r.code,
        totalReceived: r._sum.qty ?? 0,
        totalIssued: issued,
        balance: Number(r._sum.qty ?? 0) - Number(issued),
      };
    });
  }
}
