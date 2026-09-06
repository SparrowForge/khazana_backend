import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      /**
       * Prisma's interactive transactions default to a 5s budget and a 2s wait
       * for a connection. That is a LATENCY budget, not a work budget: every
       * statement in the transaction is a separate round trip, and this app runs
       * on Vercel against a Neon database in ap-southeast-1. A dozen round trips
       * — an ordinary document write with its stock check and deduction — spends
       * the whole 5s on the wire while doing almost no work.
       *
       * Blowing it surfaces as P2028 ("Transaction already closed") which Nest
       * reports as an opaque 500, so a perfectly valid sale is rejected with no
       * usable message. The work is still one atomic unit and still rolls back
       * as one; only the ceiling moves.
       *
       * Set here rather than per call site so a flow that was never explicitly
       * budgeted can't inherit the 5s default by omission — which is exactly how
       * the POS split-payment sale broke.
       */
      transactionOptions: { maxWait: 15_000, timeout: 30_000 },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
