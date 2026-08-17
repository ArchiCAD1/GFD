export type ProjectClass = "residential" | "commercial";

export interface PricingConfiguration {
  version: string;
  effectiveDate: string;
  published: boolean;
  complete: boolean;
  baseRates: Record<ProjectClass, number | null>;
  roomRates: Record<string, number>;
  serviceRates: Record<string, number>;
  lowMultiplier: number | null;
  highMultiplier: number | null;
  gctPercent: number;
  includeGCT: boolean;
  enabledCurrencies: Array<"USD" | "JMD">;
  usdToJmd: number;
  exchangeRateAsOf: string;
}

export interface EstimateInput {
  classification: ProjectClass;
  squareFeet: number;
  rooms: Record<string, number>;
  services: string[];
  currency: "USD" | "JMD";
}

export interface EstimateResult {
  baseUSD: number;
  roomAddOnsUSD: number;
  serviceAddOnsUSD: number;
  subtotalUSD: number;
  gctUSD: number;
  totalUSD: number;
  lowUSD: number;
  highUSD: number;
  displayCurrency: "USD" | "JMD";
  conversionRate: number;
  base: number;
  addOns: number;
  total: number;
  low: number;
  high: number;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function isPricingComplete(config: PricingConfiguration): boolean {
  return Boolean(
    config.published &&
    config.complete &&
    config.baseRates.residential &&
    config.baseRates.commercial &&
    config.lowMultiplier &&
    config.highMultiplier &&
    config.lowMultiplier <= config.highMultiplier &&
    config.usdToJmd > 0 &&
    config.enabledCurrencies.length
  );
}

export function calculateEstimate(input: EstimateInput, config: PricingConfiguration): EstimateResult {
  if (!Number.isFinite(input.squareFeet) || input.squareFeet < 100 || input.squareFeet > 2_000_000) {
    throw new Error("Square footage is outside the supported range.");
  }
  const baseRate = config.baseRates[input.classification];
  if (baseRate == null || baseRate <= 0 || config.lowMultiplier == null || config.highMultiplier == null) {
    throw new Error("Pricing is incomplete for this project classification.");
  }
  if (!config.enabledCurrencies.includes(input.currency)) {
    throw new Error("Selected currency is not enabled.");
  }

  const baseUSD = input.squareFeet * baseRate;
  const roomAddOnsUSD = Object.entries(input.rooms).reduce((sum, [key, count]) => {
    const boundedCount = Math.max(0, Math.min(500, Number(count) || 0));
    return sum + boundedCount * (config.roomRates[key] ?? 0);
  }, 0);
  const serviceAddOnsUSD = [...new Set(input.services)].reduce(
    (sum, service) => sum + (config.serviceRates[service] ?? 0),
    0
  );
  const subtotalUSD = baseUSD + roomAddOnsUSD + serviceAddOnsUSD;
  const gctUSD = config.includeGCT ? subtotalUSD * (config.gctPercent / 100) : 0;
  const totalUSD = subtotalUSD + gctUSD;
  const factor = input.currency === "JMD" ? config.usdToJmd : 1;

  return {
    baseUSD: money(baseUSD),
    roomAddOnsUSD: money(roomAddOnsUSD),
    serviceAddOnsUSD: money(serviceAddOnsUSD),
    subtotalUSD: money(subtotalUSD),
    gctUSD: money(gctUSD),
    totalUSD: money(totalUSD),
    lowUSD: money(totalUSD * config.lowMultiplier),
    highUSD: money(totalUSD * config.highMultiplier),
    displayCurrency: input.currency,
    conversionRate: factor,
    base: money(baseUSD * factor),
    addOns: money((roomAddOnsUSD + serviceAddOnsUSD) * factor),
    total: money(totalUSD * factor),
    low: money(totalUSD * config.lowMultiplier * factor),
    high: money(totalUSD * config.highMultiplier * factor)
  };
}
