import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ReportsService } from '../reports/reports.service';

/** Reports that can be shared. A key not on this list is refused rather than
 *  stored, so a typo cannot create a link that 404s only when someone opens it. */
const SHAREABLE = ['demand'] as const;
export type ShareableReport = (typeof SHAREABLE)[number];

/** The Demand Report's query, as it is stored on a share. */
export interface DemandShareParams {
  fromDate?: string;
  toDate?: string;
  fromBranchId?: string;
  toBranchId?: string;
  orderType?: string;
}

/**
 * Public share links for a generated report.
 *
 * The share row's UUID is the token and the whole of the access control, the
 * same model as the public credit-sale invoice link: unguessable, but a bearer
 * secret that cannot be recalled once sent.
 *
 * A share stores the QUERY, not the rendered sheet, so the link always shows
 * current data — a demand order added later appears on a link sent yesterday.
 */
@Injectable()
export class ReportSharesService {
  constructor(
    private prisma: PrismaService,
    private reports: ReportsService,
  ) {}

  async create(
    reportKey: string,
    params: Record<string, unknown>,
    createdBy: string,
    sessionBranchId?: string,
  ) {
    if (!SHAREABLE.includes(reportKey as ShareableReport)) {
      throw new BadRequestException(`'${reportKey}' is not a shareable report`);
    }
    // Run it once before handing out a link: whatever would make the public
    // route fail — not at the factory, a bad date range — should be an error the
    // sharer sees now, not something the recipient discovers.
    await this.run(reportKey, params as DemandShareParams, sessionBranchId);

    const share = await this.prisma.report_Share.create({
      data: {
        reportKey,
        params: JSON.stringify(params ?? {}),
        sessionBranchId: sessionBranchId ?? null,
        isActive: 1,
        createBy: createdBy,
        createDate: new Date(),
      },
      select: { id: true },
    });
    return { token: share.id };
  }

  /** Resolves a token and re-runs its report. Unauthenticated callers land here. */
  async resolve(token: string) {
    const share = await this.prisma.report_Share
      .findUnique({ where: { id: token } })
      .catch(() => null); // a malformed uuid is just "not found"
    // Deliberately vague, like the public invoice route: someone probing tokens
    // learns only that this one is not live.
    if (!share || share.isActive !== 1) throw new NotFoundException('This link is not valid');

    const params = JSON.parse(share.params) as DemandShareParams;
    const data = await this.run(share.reportKey, params, share.sessionBranchId ?? undefined);
    return { reportKey: share.reportKey, data };
  }

  private run(reportKey: string, params: DemandShareParams, sessionBranchId?: string) {
    switch (reportKey) {
      case 'demand':
        // sessionBranchId is the SHARER's branch, captured when the link was
        // made — the factory-only gate has nothing else to check against once
        // there is no session behind the request.
        return this.reports.getDemandReport({ ...params, sessionBranchId });
      default:
        throw new BadRequestException(`'${reportKey}' is not a shareable report`);
    }
  }
}
