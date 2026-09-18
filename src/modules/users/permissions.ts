import { z } from "zod";

export const appointmentKinds = ["ANCIANO", "SIERVO_MINISTERIAL", "PUBLICADOR"] as const;
export const capabilityKinds = ["CONDUCTOR", "PRECURSOR"] as const;
export const responsibilityKinds = [
  "COORDINADOR",
  "SUPERINTENDENTE_SERVICIO",
  "SIERVO_TERRITORIOS",
  "SUPERINTENDENTE_GRUPO",
  "AUXILIAR_GRUPO",
] as const;
export const globalResponsibilityKinds = [
  "COORDINADOR",
  "SUPERINTENDENTE_SERVICIO",
  "SIERVO_TERRITORIOS",
] as const;
export const groupResponsibilityKinds = ["SUPERINTENDENTE_GRUPO", "AUXILIAR_GRUPO"] as const;
export const legacyRoleKinds = ["ADMIN", "ANCIANO", "CONDUCTOR", "PUBLICADOR"] as const;

export type AppointmentKind = (typeof appointmentKinds)[number];
export type CapabilityKind = (typeof capabilityKinds)[number];
export type ResponsibilityKind = (typeof responsibilityKinds)[number];
export type GlobalResponsibilityKind = (typeof globalResponsibilityKinds)[number];
export type GroupResponsibilityKind = (typeof groupResponsibilityKinds)[number];
export type LegacyRoleKind = (typeof legacyRoleKinds)[number];

export const appointmentSchema = z.enum(appointmentKinds);
export const capabilitySchema = z.enum(capabilityKinds);
export const responsibilitySchema = z.enum(responsibilityKinds);
export const legacyRoleSchema = z.enum(legacyRoleKinds);

export type PermissionProfile = {
  appointment: AppointmentKind;
  capabilities: readonly CapabilityKind[];
};

export type LegacyPermissionMapping = PermissionProfile & {
  globalResponsibilities: GlobalResponsibilityKind[];
};

const requiresElderAndDriver = new Set<ResponsibilityKind>([
  "COORDINADOR",
  "SUPERINTENDENTE_SERVICIO",
]);
const requiresElder = new Set<ResponsibilityKind>(["SUPERINTENDENTE_GRUPO"]);
const requiresElderOrMinisterialServant = new Set<ResponsibilityKind>([
  "SIERVO_TERRITORIOS",
  "AUXILIAR_GRUPO",
]);

export function isEligibleForResponsibility(profile: PermissionProfile, responsibility: ResponsibilityKind) {
  const capabilities = new Set(profile.capabilities);

  if (requiresElderAndDriver.has(responsibility)) {
    return profile.appointment === "ANCIANO" && capabilities.has("CONDUCTOR");
  }

  if (requiresElder.has(responsibility)) {
    return profile.appointment === "ANCIANO";
  }

  if (requiresElderOrMinisterialServant.has(responsibility)) {
    return profile.appointment === "ANCIANO" || profile.appointment === "SIERVO_MINISTERIAL";
  }

  return false;
}

export function responsibilityEligibilityMessage(responsibility: ResponsibilityKind) {
  switch (responsibility) {
    case "COORDINADOR":
      return "El coordinador debe ser anciano y conductor.";
    case "SUPERINTENDENTE_SERVICIO":
      return "El superintendente de servicio debe ser anciano y conductor.";
    case "SIERVO_TERRITORIOS":
      return "El siervo de territorios debe ser anciano o siervo ministerial.";
    case "SUPERINTENDENTE_GRUPO":
      return "El superintendente de grupo debe ser anciano.";
    case "AUXILIAR_GRUPO":
      return "El auxiliar de grupo debe ser anciano o siervo ministerial.";
  }
}

const uniqueValues = <T extends string>(values: readonly T[]) => new Set(values).size === values.length;

export const structuredPermissionsSchema = z
  .object({
    appointment: appointmentSchema,
    capabilities: z.array(capabilitySchema).default([]),
    globalResponsibilities: z.array(z.enum(globalResponsibilityKinds)).default([]),
    groupResponsibilities: z
      .array(
        z.object({
          groupId: z.string().uuid(),
          responsibility: z.enum(groupResponsibilityKinds),
        }),
      )
      .default([]),
  })
  .superRefine((value, context) => {
    if (!uniqueValues(value.capabilities)) {
      context.addIssue({ code: "custom", path: ["capabilities"], message: "Las características no pueden repetirse." });
    }

    const responsibilities: { responsibility: ResponsibilityKind; path: (string | number)[] }[] = [
      ...value.globalResponsibilities.map((responsibility, index) => ({
        responsibility,
        path: ["globalResponsibilities", index],
      })),
      ...value.groupResponsibilities.map((assignment, index) => ({
        responsibility: assignment.responsibility,
        path: ["groupResponsibilities", index, "responsibility"],
      })),
    ];

    for (const { responsibility, path } of responsibilities) {
      if (!isEligibleForResponsibility(value, responsibility)) {
        context.addIssue({
          code: "custom",
          path,
          message: responsibilityEligibilityMessage(responsibility),
        });
      }
    }

    const activeGroupAssignments = new Set<string>();
    for (const assignment of value.groupResponsibilities) {
      const key = `${assignment.groupId}:${assignment.responsibility}`;
      if (activeGroupAssignments.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["groupResponsibilities"],
          message: "Un grupo solo puede tener una asignación activa por responsabilidad.",
        });
        break;
      }
      activeGroupAssignments.add(key);
    }
  });

export type StructuredPermissions = z.infer<typeof structuredPermissionsSchema>;

/** Maps legacy roles without changing or deleting their source rows. */
export function mapLegacyRolesToStructuredPermissions(roles: readonly LegacyRoleKind[]): LegacyPermissionMapping {
  const legacyRoles = new Set(roles);
  const isLegacyAdmin = legacyRoles.has("ADMIN");
  const appointment: AppointmentKind = isLegacyAdmin || legacyRoles.has("ANCIANO")
    ? "ANCIANO"
    : "PUBLICADOR";
  const capabilities: CapabilityKind[] = legacyRoles.has("CONDUCTOR") || isLegacyAdmin ? ["CONDUCTOR"] : [];

  return {
    appointment,
    capabilities,
    globalResponsibilities: isLegacyAdmin ? ["COORDINADOR"] : [],
  };
}
