import { z } from "zod";

export const roles = ["ADMIN", "ANCIANO"] as const;
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
