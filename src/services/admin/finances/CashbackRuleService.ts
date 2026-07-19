import { CashbackRuleRepository } from "@/repositories/shared/CashbackRuleRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";

export class CashbackRuleService {
  constructor(private cashbackRuleRepository: CashbackRuleRepository) {}

  async create(data: any) {
    return this.cashbackRuleRepository.create(data);
  }

  async getAll(page: number = 1, limit: number = 10, filters: any = {}) {
    return this.cashbackRuleRepository.findWithPagination(
      filters,
      page,
      limit,
      { createdAt: -1 }
    );
  }

  async getById(id: string) {
    const rule = await this.cashbackRuleRepository.findById(id);
    if (!rule) {
      throw new AppError("Cashback rule not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }
    return rule;
  }

  async update(id: string, data: any) {
    const rule = await this.cashbackRuleRepository.update(id, data);
    if (!rule) {
      throw new AppError("Cashback rule not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }
    return rule;
  }

  async delete(id: string) {
    const success = await this.cashbackRuleRepository.delete(id);
    if (!success) {
      throw new AppError("Cashback rule not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }
    return true;
  }

  async findApplicableRule(
    serviceId: string
  ) {
    // Find all active rules
    const activeRules = await this.cashbackRuleRepository.findActiveRules();

    // Match rules from most specific to least specific
    const rules = activeRules.filter((r) => {
      let isMatch = true;
      if (r.serviceId && r.serviceId.toString() !== serviceId) isMatch = false;
      return isMatch;
    });

    if (rules.length === 0) return null;

    return rules[0];
  }
}
