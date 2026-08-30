import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PosProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const today = new Date();

    const items = await this.prisma.item_Information.findMany({
      include: {
        prices: {
          where: { priceIsActive: 1 },
          orderBy: { priceFromDate: 'desc' },
        },
        image: true,
        inventory: true,
      },
      orderBy: { itmName: 'asc' },
    });

    return items
      .map((item) => {
        // Pick the price whose date range covers today; fall back to latest active price
        const price =
          item.prices.find((p) => {
            const from = p.priceFromDate;
            const to = p.priceToDate;
            return (!from || from <= today) && (!to || to >= today);
          }) ?? item.prices[0];

        if (!price?.priceListPrice) return null;

        // On-hand stock (0 if no inventory row on file). Sent so the terminal
        // can cache it and show live counts while offline.
        const stock = Number(item.inventory?.quantity ?? 0);

        return {
          id: item.id,
          itmCode: item.itmCode,
          name: item.itmName ?? item.itmCode,
          uom: item.itmUOM ?? 'PCS',
          price: price.priceListPrice,
          vatPercentage: price.priceVatPercent ?? 0,
          stock,
          imageUrl: item.image?.fileUrl ?? null,
          // Sent so the terminal's running total matches what the server will
          // charge — and so an offline sale, priced entirely on the client,
          // applies the same rule.
          isDiscountApplicable: item.isDiscountApplicable,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }
}
