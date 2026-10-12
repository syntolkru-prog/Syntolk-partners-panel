export const COACH_TABLES = ['CoachProfile', 'CoachPlan', 'CoachTask', 'CoachPlacement', 'CoachMessage', 'CoachRun', 'CoachReview', 'CoachNotification', 'CoachAuditEvent', 'CoachKnowledgeItem', 'CoachForecastSnapshot'] as const;
export interface CoachRecord {
  id: string; tenantId: string; partnerId: string | null; programId: string | null;
  status: string; version: number; data: Record<string, unknown>; createdAt: Date; updatedAt: Date;
}
