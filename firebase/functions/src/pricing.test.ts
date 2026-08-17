import assert from "node:assert/strict";
import test from "node:test";
import { calculateEstimate, isPricingComplete, PricingConfiguration } from "./pricing.js";

const config: PricingConfiguration = {
  version: "test-v1",
  effectiveDate: "2026-08-16",
  published: true,
  complete: true,
  baseRates: { residential: 1.28, commercial: 1.5 },
  roomRates: { bedrooms: 75 },
  serviceRates: { structural: 500 },
  lowMultiplier: 0.9,
  highMultiplier: 1.1,
  gctPercent: 15,
  includeGCT: true,
  enabledCurrencies: ["USD", "JMD"],
  usdToJmd: 156,
  exchangeRateAsOf: "2026-08-16"
};

test("calculates a server-authoritative residential range", () => {
  const value = calculateEstimate({
    classification: "residential",
    squareFeet: 2_000,
    rooms: { bedrooms: 3 },
    services: ["structural"],
    currency: "USD"
  }, config);
  assert.equal(value.base, 2_560);
  assert.equal(value.addOns, 725);
  assert.equal(value.total, 3_777.75);
  assert.equal(value.low, 3_399.98);
  assert.equal(value.high, 4_155.53);
});

test("locks JMD conversion to the pricing snapshot", () => {
  const value = calculateEstimate({
    classification: "commercial",
    squareFeet: 1_000,
    rooms: {},
    services: [],
    currency: "JMD"
  }, config);
  assert.equal(value.base, 234_000);
  assert.equal(value.conversionRate, 156);
});

test("blocks incomplete production pricing", () => {
  assert.equal(isPricingComplete({ ...config, baseRates: { ...config.baseRates, commercial: null } }), false);
  assert.throws(() => calculateEstimate({
    classification: "commercial", squareFeet: 500, rooms: {}, services: [], currency: "USD"
  }, { ...config, baseRates: { ...config.baseRates, commercial: null } }));
});
