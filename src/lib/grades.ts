export type MQLGrade = 'Hot' | 'Warm' | 'Cold' | 'Inactive';
export type HealthGrade = 'Healthy' | 'Warning' | 'Risk' | 'Critical';

export function getMQLGrade(score: number): MQLGrade {
  if (score >= 80) return 'Hot';
  if (score >= 50) return 'Warm';
  if (score >= 20) return 'Cold';
  return 'Inactive';
}

export function getHealthGrade(score: number): HealthGrade {
  if (score >= 80) return 'Healthy';
  if (score >= 50) return 'Warning';
  if (score >= 20) return 'Risk';
  return 'Critical';
}

export function getMQLStyles(grade: MQLGrade) {
  switch (grade) {
    case 'Hot': return 'text-pql-hot bg-pql-hot-bg';
    case 'Warm': return 'text-pql-warm bg-pql-warm-bg';
    case 'Cold': return 'text-pql-cold bg-pql-cold-bg';
    case 'Inactive': return 'text-pql-inactive bg-pql-inactive-bg';
  }
}

export function getHealthStyles(grade: HealthGrade) {
  switch (grade) {
    case 'Healthy': return 'text-health-healthy bg-health-healthy-bg';
    case 'Warning': return 'text-health-warning bg-health-warning-bg';
    case 'Risk': return 'text-health-risk bg-health-risk-bg';
    case 'Critical': return 'text-health-critical bg-health-critical-bg';
  }
}

export const DEAL_STAGES = [
  'Lead', 'Exhibition_Lead', 'Trial_Coupon', 'Training_License',
  'Pilot', 'Proposal', 'Contract', 'Active_User'
] as const;

export type DealStage = typeof DEAL_STAGES[number];

export function daysUntilExpiry(expirationDate: string | undefined): number | null {
  if (!expirationDate) return null;
  const diff = new Date(expirationDate).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
