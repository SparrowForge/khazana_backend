// Read-only verification of the new getVatCreditSaleInvoice query logic
// against the real DB. No writes. Temporary — delete after use.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sale = await prisma.cSVMaster.findFirst({
    include: {
      customer: { select: { id: true, code: true, name: true, mobile: true, address: true } },
      details: true,
    },
    orderBy: { invDate: 'desc' },
  });

  if (!sale) {
    console.log('No CSVMaster rows found in DB — cannot verify against real data.');
    return;
  }

  console.log('Sample CSVMaster row:', {
    id: sale.id,
    invNo: sale.invNo,
    clientCode: sale.clientCode,
    branchId: sale.branchId,
    detailCount: sale.details.length,
  });
  console.log('Resolved customer relation:', sale.customer);

  const itemIds = [...new Set(sale.details.map((d) => d.itemOId).filter((v): v is string => !!v))];
  console.log('Distinct itemOId values on details:', itemIds);

  const itemRows = itemIds.length
    ? await prisma.item_Information.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, itmCode: true, itmName: true, itmUOM: true },
      })
    : [];
  console.log('Resolved item_Information rows:', itemRows);

  const branch = sale.branchId
    ? await prisma.branch.findUnique({
        where: { id: sale.branchId },
        select: { branchName: true, address: true, vatNo: true, mobileNo: true },
      })
    : null;
  console.log('Resolved branch:', branch);
}

main()
  .catch((e) => {
    console.error('ERROR', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
