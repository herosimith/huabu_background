import { calculateCreditCost } from "../src/services/creditService.js";
import type { CreditRuleRecord } from "../src/types.js";

const rule: CreditRuleRecord = {
  id: "test_rule",
  version: 7,
  active: true,
  signupGrant: 20,
  costs: { standardGeneration: 2, highQualitySurcharge: 1, highResolutionSurcharge: 3 },
  createdBy: "test",
  createdAt: new Date(0).toISOString()
};

const cases = [
  { input: { size: "1024x1024", quality: "low" }, expected: 2 },
  { input: { size: "1024x1024", quality: "high" }, expected: 3 },
  { input: { size: "3840x2160", quality: "high" }, expected: 6 },
  { input: { size: "3840x2160", quality: "high", mock: true }, expected: 0 }
];

for (const item of cases) {
  const actual = calculateCreditCost(rule, item.input);
  if (actual !== item.expected) throw new Error(`Expected ${item.expected}, received ${actual} for ${JSON.stringify(item.input)}`);
}

console.log(JSON.stringify({ ok: true, checked: cases.length }, null, 2));
