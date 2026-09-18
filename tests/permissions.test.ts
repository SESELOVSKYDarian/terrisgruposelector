import assert from "node:assert/strict";
import test from "node:test";

import {
  isEligibleForResponsibility,
  mapLegacyRolesToStructuredPermissions,
  structuredPermissionsSchema,
} from "../src/modules/users/permissions";

test("el nombramiento es mutuamente exclusivo en el contrato tipado", () => {
  const result = structuredPermissionsSchema.safeParse({
    appointment: ["ANCIANO", "PUBLICADOR"],
  });

  assert.equal(result.success, false);
});

test("coordinador y superintendente de servicio requieren anciano conductor", () => {
  assert.equal(
    isEligibleForResponsibility({ appointment: "ANCIANO", capabilities: ["CONDUCTOR"] }, "COORDINADOR"),
    true,
  );
  assert.equal(
    isEligibleForResponsibility({ appointment: "ANCIANO", capabilities: [] }, "SUPERINTENDENTE_SERVICIO"),
    false,
  );
  assert.equal(
    isEligibleForResponsibility({ appointment: "SIERVO_MINISTERIAL", capabilities: ["CONDUCTOR"] }, "COORDINADOR"),
    false,
  );
});

test("las responsabilidades de grupo respetan su nombramiento", () => {
  assert.equal(
    isEligibleForResponsibility({ appointment: "ANCIANO", capabilities: [] }, "SUPERINTENDENTE_GRUPO"),
    true,
  );
  assert.equal(
    isEligibleForResponsibility({ appointment: "SIERVO_MINISTERIAL", capabilities: [] }, "SUPERINTENDENTE_GRUPO"),
    false,
  );
  assert.equal(
    isEligibleForResponsibility({ appointment: "SIERVO_MINISTERIAL", capabilities: [] }, "AUXILIAR_GRUPO"),
    true,
  );
});

test("el puente legacy ADMIN conserva acceso como anciano conductor coordinador", () => {
  assert.deepEqual(mapLegacyRolesToStructuredPermissions(["ADMIN"]), {
    appointment: "ANCIANO",
    capabilities: ["CONDUCTOR"],
    globalResponsibilities: ["COORDINADOR"],
  });
  assert.deepEqual(mapLegacyRolesToStructuredPermissions(["PUBLICADOR", "CONDUCTOR"]), {
    appointment: "PUBLICADOR",
    capabilities: ["CONDUCTOR"],
    globalResponsibilities: [],
  });
});
