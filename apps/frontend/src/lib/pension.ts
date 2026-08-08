export interface PensionProjectionPoint {
  year: number;
  balance: number;
  grossPayout: number;
  netPayout: number;
  taxPaid: number;
}

export function calculateIsraeliPensionTax(annualGross: number, currentYear: number, isAge67: boolean): number {
  if (annualGross <= 0) return 0;
  const monthlyGross = annualGross / 12;

  const INFLATION_RATE = 1.015;
  const yearsFrom2026 = Math.max(0, currentYear - 2026);
  const inflationFactor = Math.pow(INFLATION_RATE, yearsFrom2026);

  const baseBrackets = [
    { limit: 7010, rate: 0.10 },
    { limit: 10060, rate: 0.14 },
    { limit: 16150, rate: 0.20 },
    { limit: 22440, rate: 0.31 },
    { limit: 46690, rate: 0.35 },
    { limit: 60000, rate: 0.47 },
    { limit: Infinity, rate: 0.50 }
  ];

  const baseCreditPoint = 242;
  const creditPointsAmount = 2.25 * baseCreditPoint * inflationFactor;
  const kibuaZchuyotBase = 5422;
  const kibuaZchuyot = isAge67 ? kibuaZchuyotBase * inflationFactor : 0;

  // Kitzba Mukeret (15%) is tax exempt
  const taxableIncome = Math.max(0, monthlyGross * 0.85 - kibuaZchuyot);
  let tax = 0;
  let previousLimit = 0;

  for (const bracket of baseBrackets) {
    const inflatedLimit = bracket.limit * inflationFactor;
    if (taxableIncome > previousLimit) {
      const taxableInBracket = Math.min(taxableIncome, inflatedLimit) - previousLimit;
      tax += taxableInBracket * bracket.rate;
    }
    previousLimit = inflatedLimit;
  }

  const monthlyTax = Math.max(0, tax - creditPointsAmount);
  return monthlyTax * 12;
}

export function generatePensionProjection(
  currentYear: number,
  birthYear: number,
  startValue: number,
  monthlyDeposit: number,
  stopWorkYear: number,
  startAge: number,
  annualGrowthRate: number,
  divideRate: number
): PensionProjectionPoint[] {
  const result: PensionProjectionPoint[] = [];
  const monthlyRate = annualGrowthRate / 12;

  let currentVal = startValue;

  // We project for 100 years from birth
  const endYear = birthYear + 100;

  for (let year = currentYear; year <= endYear; year++) {
    const age = year - birthYear;
    let grossPayout = 0;
    let netPayout = 0;
    let taxPaid = 0;

    if (age >= startAge) {
      // Payout phase
      if (currentVal > 0 && divideRate > 0) {
        grossPayout = (currentVal / divideRate) * 12;
        const isAge67 = age >= 67;
        taxPaid = calculateIsraeliPensionTax(grossPayout, year, isAge67);
        netPayout = grossPayout - taxPaid;
      }
      // Assuming it's an annuity, the "balance" conceptually drops to 0 or we just don't grow it.
      // In the simulation, we set account.value = 0 to avoid double counting.
      // But for pure projection, maybe we want to show the balance?
      // Typically, an annuity consumes the balance. Let's set it to 0.
      currentVal = 0;

      result.push({
        year,
        balance: 0,
        grossPayout,
        netPayout,
        taxPaid
      });
    } else {
      // Growth phase
      const isDepositing = year < stopWorkYear;
      const deposit = isDepositing ? monthlyDeposit : 0;

      // Grow for 12 months
      for (let i = 0; i < 12; i++) {
        currentVal = currentVal * (1 + monthlyRate) + deposit;
      }

      result.push({
        year,
        balance: currentVal,
        grossPayout: 0,
        netPayout: 0,
        taxPaid: 0
      });
    }
  }

  return result;
}

export function calculateProjectedPensionPayout(
  currentValue: number,
  monthlyDeposit: number,
  currentAge: number,
  targetAge: number,
  stopWorkAge: number,
  annualGrowthRate: number,
  divideRate: number
): { projectedValue: number, monthlyPayout: number } {
  const currentYear = new Date().getFullYear();
  const birthYear = currentYear - currentAge;
  const stopWorkYear = birthYear + stopWorkAge;

  const projection = generatePensionProjection(
    currentYear,
    birthYear,
    currentValue,
    monthlyDeposit,
    stopWorkYear,
    targetAge,
    annualGrowthRate,
    divideRate
  );

  const targetPoint = projection.find(p => p.year === birthYear + targetAge);
  if (!targetPoint) return { projectedValue: 0, monthlyPayout: 0 };

  // To find the projected value right before it turns to 0
  const priorPoint = projection.find(p => p.year === birthYear + targetAge - 1);
  const projectedValue = priorPoint ? priorPoint.balance : currentValue;

  return {
    projectedValue,
    monthlyPayout: targetPoint.grossPayout / 12
  };
}
