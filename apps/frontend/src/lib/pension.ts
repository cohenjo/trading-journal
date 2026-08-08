export function calculateProjectedPensionPayout(
  currentValue: number,
  monthlyDeposit: number,
  currentAge: number,
  targetAge: number,
  stopWorkAge: number,
  annualGrowthRate: number,
  divideRate: number
): { projectedValue: number, monthlyPayout: number } {
  const monthsToStop = Math.max(0, (stopWorkAge - currentAge) * 12);
  const totalMonths = Math.max(0, (targetAge - currentAge) * 12);
  const monthlyRate = annualGrowthRate / 12;

  let val = currentValue;
  for (let i = 0; i < totalMonths; i++) {
    const dep = i < monthsToStop ? monthlyDeposit : 0;
    val = val * (1 + monthlyRate) + dep;
  }

  return {
    projectedValue: val,
    monthlyPayout: divideRate > 0 ? (val / divideRate) : 0
  };
}
