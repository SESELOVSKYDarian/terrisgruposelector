export const planningStatuses = ["DRAFT", "IN_REVIEW", "PUBLISHED"] as const;
export type PlanningStatus = (typeof planningStatuses)[number];

export const slotStatuses = ["PROGRAMADA", "REALIZADA", "CANCELADA"] as const;
export type SlotStatus = (typeof slotStatuses)[number];

export type PlanningTransition = "SUBMIT" | "RETURN_TO_DRAFT" | "PUBLISH";

/** What the caller may do with the weekly plan. Derived server-side, never from the client. */
export type PlanningAuthority = { canPlan: boolean; canPublish: boolean };

const transitionTable: Record<PlanningTransition, { from: PlanningStatus; to: PlanningStatus }> = {
  SUBMIT: { from: "DRAFT", to: "IN_REVIEW" },
  RETURN_TO_DRAFT: { from: "IN_REVIEW", to: "DRAFT" },
  PUBLISH: { from: "IN_REVIEW", to: "PUBLISHED" },
};

export function isPlanningStatus(value: unknown): value is PlanningStatus {
  return typeof value === "string" && (planningStatuses as readonly string[]).includes(value);
}

export function isSlotStatus(value: unknown): value is SlotStatus {
  return typeof value === "string" && (slotStatuses as readonly string[]).includes(value);
}

/** Resulting status, or null when the transition is not valid from `current`. */
export function nextPlanningStatus(current: PlanningStatus, transition: PlanningTransition): PlanningStatus | null {
  const rule = transitionTable[transition];
  return rule.from === current ? rule.to : null;
}

/** Siervo de Territorios prepares and submits; only Superintendente de Servicio reviews. */
export function canPerformTransition(authority: PlanningAuthority, transition: PlanningTransition) {
  if (transition === "SUBMIT") return authority.canPlan || authority.canPublish;
  return authority.canPublish;
}

export function canEditWeek(authority: PlanningAuthority, status: PlanningStatus) {
  if (status === "IN_REVIEW") return authority.canPublish;
  return authority.canPlan || authority.canPublish;
}

export function canDeleteWeek(authority: PlanningAuthority, status: PlanningStatus) {
  if (status === "DRAFT") return authority.canPlan || authority.canPublish;
  return authority.canPublish;
}

/** Regular users only ever see PUBLISHED weeks; planners see every state. */
export function canViewWeek(authority: PlanningAuthority, status: PlanningStatus) {
  return status === "PUBLISHED" || authority.canPlan || authority.canPublish;
}

/** Editing a published week without publish authority must notify the Superintendente de Servicio. */
export function editNeedsSuperintendentNotice(authority: PlanningAuthority, status: PlanningStatus) {
  return status === "PUBLISHED" && !authority.canPublish;
}

/** Conductors are only told about an outing once the plan they belong to is published. */
export function shouldNotifyConductor(status: PlanningStatus) {
  return status === "PUBLISHED";
}

/**
 * Legacy ADMIN keeps planning ability only while nobody holds the matching V2
 * responsibility, so the live app is never locked out before responsibilities are
 * assigned. As soon as one profile holds it, the strict V2 rule applies.
 * The Coordinador role by itself never grants planning permissions.
 */
export function derivePlanningAuthority(input: {
  hasPlanPermission: boolean;
  hasPublishPermission: boolean;
  isLegacyAdmin: boolean;
  planHeldByAnyone: boolean;
  publishHeldByAnyone: boolean;
}): PlanningAuthority {
  return {
    canPlan: input.hasPlanPermission || (input.isLegacyAdmin && !input.planHeldByAnyone),
    canPublish: input.hasPublishPermission || (input.isLegacyAdmin && !input.publishHeldByAnyone),
  };
}

export type SlotSnapshot = {
  hora: string | null;
  lugar: string | null;
  conductor_id: string | null;
  note: string | null;
  highlighted: boolean;
  status: SlotStatus;
};

const slotFieldLabels: Record<keyof SlotSnapshot, string> = {
  hora: "hora",
  lugar: "lugar",
  conductor_id: "conductor",
  note: "nota",
  highlighted: "destacada",
  status: "estado",
};

/** Human-readable names of the fields whose value actually changed. */
export function changedSlotFields(before: SlotSnapshot, after: Partial<SlotSnapshot>) {
  return (Object.keys(after) as (keyof SlotSnapshot)[])
    .filter((field) => after[field] !== undefined && after[field] !== before[field])
    .map((field) => slotFieldLabels[field]);
}
