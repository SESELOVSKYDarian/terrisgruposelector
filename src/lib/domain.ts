import { z } from "zod";

export const roles = ["ADMIN", "ANCIANO", "CONDUCTOR", "PUBLICADOR"] as const;
export const blockStatuses = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "NEEDS_FOLLOW_UP",
  "BLOCKED",
] as const;
export const reservationStatuses = [
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
] as const;
export const serviceDays = ["SATURDAY", "SUNDAY"] as const;

export const isoWeekdays = [1, 2, 3, 4, 5, 6, 7] as const;
export const isoWeekdayLabels: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miercoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sabado",
  7: "Domingo",
};
export const isoWeekdayShortLabels: Record<number, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mie",
  4: "Jue",
  5: "Vie",
  6: "Sab",
  7: "Dom",
};

export type Role = (typeof roles)[number];
export type BlockStatus = (typeof blockStatuses)[number];
export type ReservationStatus = (typeof reservationStatuses)[number];
export type ServiceDay = (typeof serviceDays)[number];

export type Territory = {
  id: string;
  number: number;
  name: string;
  blocksTotal: number;
  blocksCompleted: number;
  blocksPending: number;
  activeReservation?: ReservationSummary;
  lockedReason?: string;
};

export type ReservationSummary = {
  id: string;
  territoryNumber: number;
  territoryName: string;
  groupName: string;
  responsibleName: string;
  serviceDate: string;
  serviceDay: ServiceDay;
  status: ReservationStatus;
};

export type BlockProgress = {
  id: string;
  label: string;
  territoryNumber: number;
  status: BlockStatus;
  lastUpdatedBy: string;
};

export const reservationInputSchema = z
  .object({
    territoryId: z.string().uuid(),
    groupId: z.string().uuid(),
    serviceDate: z.string().date(),
    serviceDay: z.enum(serviceDays),
  })
  .superRefine((value, context) => {
    const date = new Date(`${value.serviceDate}T00:00:00`);
    const day = date.getUTCDay();
    const expected = day === 6 ? "SATURDAY" : day === 0 ? "SUNDAY" : null;

    if (!expected) {
      context.addIssue({
        code: "custom",
        path: ["serviceDate"],
        message: "Las reservas solo pueden ser para sabado o domingo.",
      });
    }

    if (expected && expected !== value.serviceDay) {
      context.addIssue({
        code: "custom",
        path: ["serviceDay"],
        message: "El dia de servicio no coincide con la fecha elegida.",
      });
    }
  });

export const statusLabels: Record<BlockStatus, string> = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completada",
  NEEDS_FOLLOW_UP: "Revisar",
  BLOCKED: "Bloqueada",
};

export const reservationStatusLabels: Record<ReservationStatus, string> = {
  ACTIVE: "Activa",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
};

export const serviceDayLabels: Record<ServiceDay, string> = {
  SATURDAY: "Sabado",
  SUNDAY: "Domingo",
};

export function calculateTerritoryProgress(territory: Territory) {
  if (territory.blocksTotal === 0) {
    return 0;
  }

  return Math.round((territory.blocksCompleted / territory.blocksTotal) * 100);
}

export function isTerritoryAvailable(territory: Territory) {
  return !territory.activeReservation && !territory.lockedReason;
}

export const passwordRequirements = [
  { id: "length", label: "Al menos 8 caracteres", test: (value: string) => value.length >= 8 },
  { id: "upper", label: "Una mayuscula", test: (value: string) => /[A-Z]/.test(value) },
  { id: "lower", label: "Una minuscula", test: (value: string) => /[a-z]/.test(value) },
  { id: "digit", label: "Un numero", test: (value: string) => /\d/.test(value) },
  { id: "special", label: "Un caracter especial", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const;

export function isPasswordValid(password: string) {
  return passwordRequirements.every((requirement) => requirement.test(password));
}

export function isEmailValid(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function deriveFullNameFromUsername(username: string) {
  const trimmed = username.trim();
  if (!trimmed) return "";
  const initial = trimmed.charAt(0).toUpperCase();
  const rest = trimmed.slice(1);
  if (!rest) return `${initial}.`;
  const surname = rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
  return `${surname} ${initial}.`;
}

export function formatPendingBlocks(labels: string[]) {
  const numbered: { prefix: string; num: number; label: string }[] = [];
  const other: string[] = [];

  for (const label of labels) {
    const match = label.match(/^([A-Za-z]*)(\d+)$/);
    if (match) numbered.push({ prefix: match[1] || "M", num: Number(match[2]), label });
    else other.push(label);
  }
  numbered.sort((a, b) => a.num - b.num || a.prefix.localeCompare(b.prefix));

  const groups: string[] = [];
  if (numbered.length) {
    let start = numbered[0];
    let prev = numbered[0];

    for (let i = 1; i <= numbered.length; i += 1) {
      const current = numbered[i];
      if (current && current.num === prev.num + 1 && current.prefix === prev.prefix) {
        prev = current;
        continue;
      }
      groups.push(start === prev ? start.label : `${start.label}-${prev.label}`);
      if (current) {
        start = current;
        prev = current;
      }
    }
  }

  return [...groups, ...other].join(",");
}

export const mockTerritories: Territory[] = [
  {
    id: "8e85d61b-0c7f-4db0-96f9-9c4f8cc5d001",
    number: 1,
    name: "Centro norte",
    blocksTotal: 12,
    blocksCompleted: 9,
    blocksPending: 3,
    activeReservation: {
      id: "d95fc82c-e685-4f00-bef9-9365c5233001",
      territoryNumber: 1,
      territoryName: "Centro norte",
      groupName: "Grupo 1",
      responsibleName: "Daniel Ruiz",
      serviceDate: "2026-07-04",
      serviceDay: "SATURDAY",
      status: "ACTIVE",
    },
  },
  {
    id: "8e85d61b-0c7f-4db0-96f9-9c4f8cc5d002",
    number: 2,
    name: "Estacion",
    blocksTotal: 10,
    blocksCompleted: 10,
    blocksPending: 0,
  },
  {
    id: "8e85d61b-0c7f-4db0-96f9-9c4f8cc5d003",
    number: 3,
    name: "Barrio oeste",
    blocksTotal: 14,
    blocksCompleted: 4,
    blocksPending: 10,
    lockedReason: "Bloqueado por seguimiento pendiente",
  },
  {
    id: "8e85d61b-0c7f-4db0-96f9-9c4f8cc5d004",
    number: 4,
    name: "Avenida sur",
    blocksTotal: 8,
    blocksCompleted: 1,
    blocksPending: 7,
  },
];

export const mockReservations: ReservationSummary[] = [
  mockTerritories[0].activeReservation!,
  {
    id: "d95fc82c-e685-4f00-bef9-9365c5233002",
    territoryNumber: 4,
    territoryName: "Avenida sur",
    groupName: "Grupo 3",
    responsibleName: "Marcos Molina",
    serviceDate: "2026-07-05",
    serviceDay: "SUNDAY",
    status: "ACTIVE",
  },
  {
    id: "d95fc82c-e685-4f00-bef9-9365c5233003",
    territoryNumber: 2,
    territoryName: "Estacion",
    groupName: "Grupo 2",
    responsibleName: "Pablo Suarez",
    serviceDate: "2026-06-28",
    serviceDay: "SUNDAY",
    status: "COMPLETED",
  },
];

export const mockBlocks: BlockProgress[] = [
  {
    id: "6bc58532-57a0-48ca-80ab-48d1c7281001",
    label: "M1",
    territoryNumber: 1,
    status: "COMPLETED",
    lastUpdatedBy: "Daniel Ruiz",
  },
  {
    id: "6bc58532-57a0-48ca-80ab-48d1c7281002",
    label: "M2",
    territoryNumber: 1,
    status: "IN_PROGRESS",
    lastUpdatedBy: "Daniel Ruiz",
  },
  {
    id: "6bc58532-57a0-48ca-80ab-48d1c7281003",
    label: "M7",
    territoryNumber: 3,
    status: "NEEDS_FOLLOW_UP",
    lastUpdatedBy: "Miguel Acosta",
  },
  {
    id: "6bc58532-57a0-48ca-80ab-48d1c7281004",
    label: "M4",
    territoryNumber: 4,
    status: "PENDING",
    lastUpdatedBy: "Sin asignar",
  },
];
