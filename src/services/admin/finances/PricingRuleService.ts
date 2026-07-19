import { Types, PipelineStage } from "mongoose";
import { CashbackRuleService } from "./CashbackRuleService";
import { PartnerCommissionService } from "@/services/partner/PartnerCommissionService";
import { CashbackRule } from "@/models/billing/fees/CashbackRule";
import { PartnerCommission } from "@/models/partner/PartnerCommission";

export interface PricingRuleRow {
  providerId: string;
  serviceId: string;
  name: string;
  type: "flat" | "percentage";
  cashbackValue?: number;
  partnerDiscountValue?: number;
  active: boolean;
}

export class PricingRuleService {
  constructor(
    private cashbackRuleService: CashbackRuleService,
    private commissionService: PartnerCommissionService,
  ) {}

  async listPricingRules(
    page = 1,
    limit = 20,
    filters: { providerId?: string; serviceId?: string; status?: string } = {},
  ) {
    const match: Record<string, any> = {};
    if (filters.providerId)
      match.providerId = new Types.ObjectId(filters.providerId);
    if (filters.serviceId)
      match.serviceId = new Types.ObjectId(filters.serviceId);
    if (filters.status !== undefined)
      match.active = filters.status === "active";

    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: PartnerCommission.collection.name,
          let: { providerId: "$providerId", serviceId: "$serviceId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$providerId", "$$providerId"] },
                    { $eq: ["$serviceId", "$$serviceId"] },
                  ],
                },
              },
            },
          ],
          as: "commission",
        },
      },
      { $unwind: { path: "$commission", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          providerId: 1,
          serviceId: 1,
          name: 1,
          type: 1,
          active: 1,
          cashbackValue: "$value",
          partnerDiscountValue: "$commission.value",
        },
      },
    ];

    const [rows, total] = await Promise.all([
      CashbackRule.aggregate(pipeline).exec(),
      CashbackRule.countDocuments(match).exec(),
    ]);

    return { rows, total };
  }

  async bulkUpsertPricingRules(rows: PricingRuleRow[]) {
    const outcomes = await Promise.allSettled(
      rows.map((row) => this.upsertRow(row)),
    );

    const results = outcomes.map((outcome, i) => {
      const row = rows[i];
      if (outcome.status === "fulfilled") {
        return {
          providerId: row.providerId,
          serviceId: row.serviceId,
          status: "ok",
        };
      }
      return {
        providerId: row.providerId,
        serviceId: row.serviceId,
        status: "error",
        error: outcome.reason?.message ?? "Update failed",
      };
    });

    const failed = results.filter((r) => r.status === "error").length;

    return {
      message: `${rows.length - failed} of ${rows.length} pricing rule(s) updated successfully`,
      results,
    };
  }

  private async upsertRow(row: PricingRuleRow) {
    const tasks: Promise<any>[] = [];

    if (row.cashbackValue !== undefined) {
      // Find existing rule
      const rules = await this.cashbackRuleService.getAll(1, 1, {
        providerId: row.providerId,
        serviceId: row.serviceId,
      });

      if (rules.data.length > 0) {
        tasks.push(
          this.cashbackRuleService.update(rules.data[0]._id.toString(), {
            type: row.type,
            value: row.cashbackValue,
            active: row.active,
          })
        );
      } else {
        tasks.push(
          this.cashbackRuleService.create({
            providerId: row.providerId,
            serviceId: row.serviceId,
            type: row.type,
            value: row.cashbackValue,
            active: row.active,
          })
        );
      }
    }

    if (row.partnerDiscountValue !== undefined) {
      tasks.push(
        this.commissionService.upsertCommission({
          providerId: row.providerId,
          serviceId: row.serviceId,
          name: row.name,
          type: row.type,
          value: row.partnerDiscountValue,
          active: row.active,
        }),
      );
    }

    return Promise.all(tasks);
  }

  async getPricingRule(providerId: string, serviceId: string) {
    const { rows } = await this.listPricingRules(1, 1, {
      providerId,
      serviceId,
    });
    return rows[0] ?? null;
  }

  async upsertPricingRule(row: PricingRuleRow) {
    await this.upsertRow(row);
    return this.getPricingRule(row.providerId, row.serviceId);
  }

  async setPricingRuleStatus(
    providerId: string,
    serviceId: string,
    active: boolean,
  ) {
    const rules = await this.cashbackRuleService.getAll(1, 100, {
      providerId,
      serviceId,
    });
    
    const tasks: Promise<any>[] = rules.data.map(r => 
      this.cashbackRuleService.update(r._id.toString(), { active })
    );

    tasks.push(
      this.commissionService.setCommissionActiveByProviderAndService(
        providerId,
        serviceId,
        active,
      ),
    );

    await Promise.all(tasks);
    return this.getPricingRule(providerId, serviceId);
  }
}
