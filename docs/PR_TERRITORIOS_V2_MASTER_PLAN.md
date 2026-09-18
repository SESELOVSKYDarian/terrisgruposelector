# PR Territorios V2 — Master Plan

## Estado y alcance de la auditoría (Fase 0)

Auditoría realizada sobre el checkout local el 17 de septiembre de 2026. Se revisaron `README.md`, `AGENTS.md`, `CLAUDE.md`, `package.json`, configuración de Next, todo `src/app`, `src/lib`, las rutas de autenticación, `src/app/api/app-data/route.ts`, `supabase/schema.sql` y cada migración SQL existente. También se revisó la lógica de roles, reservas, vueltas de territorio, visitas, salidas semanales, roster de fin de semana, puntos de salida, notificaciones, registro, OTP y WebAuthn/passkeys.

Hay modificaciones locales no relacionadas, sin commit, en `plan-territorios-conductor.md`, `src/app/page.tsx`, `src/app/globals.css` y tres componentes compartidos. No se deben sobrescribir ni incorporar accidentalmente en los commits V2.

### Arquitectura actual

- **Stack.** Next.js 16.2.9 (App Router), React 19, TypeScript estricto, Tailwind 4, Zod 4, Supabase Postgres con cliente de servidor con clave secreta, Framer Motion, Lucide, SimpleWebAuthn y Resend.
- **Presentación.** La app completa vive principalmente en `src/app/page.tsx` (159.287 bytes). Es un Client Component que concentra autenticación visual, panel administrativo, panel de ancianos, reservas, territorios, usuarios, ventanas, salidas, conductores y modales.
- **Backend.** `src/app/api/app-data/route.ts` (1.186 líneas, 53.754 bytes) implementa un RPC casero `POST { action, payload }`, más un `GET` que carga casi todos los datos. Contiene reglas de permisos, validación, CRUD y algoritmos de planificación.
- **Auth.** Autenticación propia sobre `profiles.password_hash`, cookie HMAC HttpOnly de 8 horas y Supabase service key exclusivamente en servidor. Hay login/registro pendiente de aprobación, recuperación de contraseña por Resend, OTP por correo, trust cookie y registro/login de passkeys WebAuthn. `cookies()` ya se usa correctamente con `await`, requisito de Next 16.
- **Datos existentes.** `profiles`, `profile_roles`, `groups`, `territories`, `blocks`, `annual_rounds`, `block_round_statuses`, `reservation_windows`, `territory_reservations`, `territory_locks`, `admin_notifications`, `audit_logs`, `webauthn_credentials`, `territory_rounds`, `territory_visits`, `weekly_outings`, `weekly_outing_slots`, `weekly_outing_slot_territories`, `weekend_roster`, `departure_points` y `departure_point_territories`.
- **Acceso DB.** RLS está habilitado, pero la aplicación la evita mediante service role en Route Handlers. Las políticas históricas incluyen funciones `SECURITY DEFINER` de marcador y políticas `using (false)`; no representan todavía el modelo V2 ni deben ser la única defensa. Las rutas deben validar siempre sesión y autorización.

### Flujos actuales que ya existen

| Área | Implementación actual | Valor a conservar |
| --- | --- | --- |
| Identidad | `profiles`, hash scrypt, sesión firmada, activación y aprobación | Cuentas, contraseñas, correos, grupos, estado, OTP/passkeys |
| Roles | enum legacy `ADMIN`, `ANCIANO`, luego `CONDUCTOR`, `PUBLICADOR`; `profile_roles` permite varios | Las asignaciones existentes deben backfillearse sin borrar `profiles.role` |
| Territorios | territorio numerado, manzanas, vuelta anual y estado por manzana | IDs, números, notas, manzanas y su historial |
| Reservas | ventanas sábado/domingo, respuesta por grupo, bloqueo automático | Ventanas, respuestas, fechas, responsables y bloqueos |
| Salidas | semana jueves–miércoles, filas con `hora` texto, lugar, conductor y territorios | Semanas, slots, asociaciones y puntos de salida |
| S-13 parcial | `territory_rounds` y `territory_visits`, conductor inicial y progreso | Historial de visitas/vueltas; no hay integración Docs real |
| Conductores | rol, formulario de visita y roster de fin de semana por fecha | Conductores y roster existente |
| Avisos | `admin_notifications` solo para admins y una acción de leído | Historial mientras se migra a inbox por usuario |

## Principales problemas estructurales y deuda técnica

1. La página y la API monolíticas mezclan UX, estado, consultas, autorización y mutaciones; cada nuevo requisito aumenta el riesgo de regresiones.
2. El RPC de una sola ruta permite que validaciones sean inconsistentes. Después de `assertAdmin`, múltiples acciones aceptan payloads no tipados y algunas realizan delete-and-reinsert sin transacción.
3. `ADMIN` amalgama administración de usuarios y operación. No expresa nombramiento, características ni responsabilidades V2.
4. `profiles.role` y `profile_roles` coexisten; el primero se sigue escribiendo por compatibilidad. No hay restricciones de incompatibilidad ni responsables de grupo normalizados.
5. Las horas de slots son `text`, por lo que no sirven para recordatorios correctos ni zona horaria; no hay `timestamptz` operativo ni configuración `America/Argentina/Buenos_Aires`.
6. Los permisos del backend son parciales: varios GET devuelven datos amplios y los cambios administrativos no tienen un modelo de capacidades. RLS histórica se basa en una función que siempre retorna `null`; el service role la saltea.
7. El actual `admin_notifications` no es por destinatario, no tiene tipo/deep link/soft delete/borrado programado, y se crea directamente desde la API.
8. `territory_rounds` captura una parte de la regla S-13, pero no registra `submitted_by`/`updated_by`, no protege el conductor original explícitamente, usa fechas sin tiempo y carece de páginas/slots S-13 e integración abstraída.
9. `territory_visits` puede editarse/eliminarse sin auditoría ni una política de ownership/supervisión V2.
10. `weekly_outings` no tiene workflow DRAFT/IN_REVIEW/PUBLISHED, historial de revisiones, timestamps reales ni la separación entre plantilla recurrente y override semanal.
11. Reservas/Ventanas y planificación son flujos paralelos: las respuestas no alimentan una entidad de salida V2 de forma transaccional.
12. No existen módulos para telefonía, edificios, no visitar, territorio personal, anuncios, eventos, push, scheduler, mapa interactivo ni auditoría con before/after.
13. No hay suite de tests ni script `test`; solo lint y build. El proyecto tampoco tiene una migración versionada en formato de Supabase CLI, sino SQL ejecutable manualmente.
14. El README sigue describiendo el modelo previo y las migraciones no tienen registro de aplicación ni verificación automatizada de conteos.

## Modelo actual de datos, conservación y destino V2

### Tablas que se conservan y reutilizan

- `profiles`: identidad, credenciales, correo, grupo, activación y aprobación. Se mantiene `role` como columna legacy hasta que todas las superficies V1 se retiren.
- `groups`: entidad de grupo existente; se amplía con asignaciones de responsables, no se recrea.
- `territories`, `blocks`: fuente de territorios y manzanas Casa en Casa.
- `annual_rounds`, `block_round_statuses`: historial global legacy de manzanas; V2 lo seguirá mostrando/reconciliando mientras `territory_rounds` se convierte en fuente operacional para S-13.
- `territory_rounds`, `territory_visits`: se migrarán aditivamente como historial de S-13/Vuelta Casa en Casa.
- `reservation_windows`, `territory_reservations`, `territory_locks`: se conservan como historial y puente para la futura salida por grupo; no se eliminan.
- `weekly_outings`, `weekly_outing_slots`, `weekly_outing_slot_territories`, `weekend_roster`, `departure_points`, `departure_point_territories`: insumos de planificación V1, que se migrarán gradualmente a las entidades V2.
- `webauthn_credentials`: passkeys existentes. `admin_notifications` y `audit_logs` se conservan como legacy; no se borran.

### Tablas que requieren migración/adaptador

| Legacy | Adaptación V2 |
| --- | --- |
| `profiles.role`, `profile_roles` | Backfill a condición/características/responsabilidades; vista/adaptador de roles legacy mientras la UI V1 exista |
| `groups` | Añadir asignaciones históricas/actuales de superintendente y auxiliar mediante tabla, no columnas rígidas |
| `weekly_outings*` | Mantener lectura V1; backfill a `planning_weeks`, `outings` y `outing_territories` cuando se implemente Fase 6 |
| `weekend_roster` | Origen de datos para overrides; sustituir gradualmente por plantillas recurrentes y excepciones en Fase 7 |
| `reservation_windows`/`territory_reservations` | Mapear a ventanas de grupo y respuestas; mantener IDs legacy para trazabilidad |
| `territory_rounds`/`territory_visits` | Añadir actor de envío/edición, salida origen, timestamps y metadatos S-13; no alterar los registros existentes destructivamente |
| `admin_notifications` | Importar opcionalmente como notificaciones por usuario del administrador; mantener tabla legacy durante transición |
| `audit_logs` | Ampliar a contrato V2 (`entity_type`, `before`, `after`, `metadata`) y leer el historial anterior como legacy |

### Nuevas tablas previstas por fase

- **Fase 1:** `profile_appointments`, `profile_capabilities`, `profile_responsibilities`, `group_responsibility_assignments`, `permission_audit_snapshots` (temporal de verificación), y columnas aditivas de compatibilidad en `profiles`.
- **Fases 4–5:** `domain_events`, `event_deliveries`, `user_notifications`, `push_subscriptions`, `scheduled_jobs`.
- **Fase 6–9:** `planning_weeks`, `planning_revisions`, `outings`, `outing_territories`, `recurring_outing_templates`, `recurring_outing_template_slots`, `weekly_outing_overrides`, `group_outing_windows`, `group_outing_responses`.
- **Fases 10 y 20:** `s13_documents`, `s13_pages`, `s13_round_slots`, sync attempts/outbox y mapping document/page/slot.
- **Fases 11–13:** `territory_map_layers`, `territory_map_features`, `do_not_visit_addresses`, `territory_phone_numbers`, `telephone_assignments`, `telephone_call_results`.
- **Fases 14–19:** `announcements`, `buildings`, `building_versions`, `building_units`, `building_proposals`, `building_census_corrections`, `building_unit_activity`, `building_rounds`, `personal_territory_assignments`, `personal_territory_reports`.

Todos los IDs nuevos serán UUID; fechas operativas serán `timestamptz`; fecha de negocio sin hora será `date`; metadata flexible será `jsonb` con índices solo donde sea consultada. Cada tabla pública tendrá RLS habilitada y políticas deliberadas; las operaciones privilegiadas seguirán validando en servidor.

## Arquitectura V2 propuesta

### Backend y dominio

```text
src/server/
  auth/             session, passwords, OTP, passkeys
  permissions/      policy engine, capability checks, validation
  events/           append-only domain events + idempotent dispatch
  notifications/    inbox and deep-link delivery
  push/              subscription management and Web Push
  scheduler/         due-job calculation and runners
  audit/             append-only audit writer
  integrations/     Google Docs S-13 adapter and future building importer

src/modules/
  auth users groups outings reservations territories territory-rounds s13
  telephone buildings personal-territories notifications announcements audit settings
```

Cada módulo expondrá contratos de dominio, validadores Zod, repositorio/servicio de servidor y rutas finas. Las rutas no aceptarán nombres de tablas ni payloads libres. Las transacciones que cambien entidad, auditoría y evento se harán en RPC/función SQL explícita o mediante operación cuidadosamente diseñada con una outbox idempotente.

### Frontend y navegación

```text
src/app/
  (auth)/login, register, reset-password
  app/layout.tsx, page.tsx
  app/salidas/{planificacion,conductores,puntos-de-salida,mis-salidas}
  app/territorios, app/reservas, app/usuarios, app/ajustes
src/components/
  ui/ shell/ command-palette/ notifications/ forms/
```

El `AppShell` sustituirá la navegación administrativa actual por sidebar lateral responsive con perfil abajo. La nueva UI convive inicialmente con pantallas V1 mediante rutas explícitas; ningún `page.tsx` V2 será monolítico. Command Palette y notification center se conectarán a datos de servidor, no al estado global de la página.

## Modelo V2 de permisos

La condición es exactamente una por usuario: `ANCIANO`, `SIERVO_MINISTERIAL` o `PUBLICADOR`. Las características son combinables: `CONDUCTOR`, `PRECURSOR`. Las responsabilidades son asignaciones independientes, con vigencia: `COORDINADOR`, `SUPERINTENDENTE_SERVICIO`, `SIERVO_TERRITORIOS`, `SUPERINTENDENTE_GRUPO`, `AUXILIAR_GRUPO`.

Reglas a imponer en base de datos y servidor:

- Coordinador, Superintendente de Servicio y Superintendente de Grupo requieren condición `ANCIANO`; Coordinador y Superintendente de Servicio requieren además `CONDUCTOR`.
- Siervo de Territorios y Auxiliar de Grupo requieren `ANCIANO` o `SIERVO_MINISTERIAL`.
- `PRECURSOR` y `CONDUCTOR` son independientes de la condición.
- Responsabilidades de grupo deben referenciar un grupo; las globales no. Un grupo puede existir sin responsables; una asignación activa por tipo/grupo se controla con índice parcial.
- Solo Coordinador administra usuarios globalmente. Superintendente de Servicio y Siervo de Territorios reciben capacidades operativas, no administración automática de usuarios.
- Se conserva el rol `ADMIN` legacy solo como puente: durante transición se interpreta como un Coordinador V2 para no bloquear al operador actual, pero no se asignará desde las nuevas APIs/UI.

Las decisiones de permiso se centralizarán en `src/modules/users/permissions.ts` y `src/server/permissions`, con validación Zod y consultas frescas al perfil. La cookie no será fuente de autorización: ya hoy `getCurrentProfile()` reconsulta DB y debe conservarse ese patrón.

## Flujos V2 prioritarios

1. Gestión de usuario: Coordinador cambia condición/características/responsabilidades/grupo; servicio valida reglas, persiste, audita y emite evento.
2. Planificación: Siervo de Territorios crea borrador, envía revisión; Superintendente de Servicio publica; cambios posteriores publican evento/auditoría sin nueva aprobación.
3. Salida por grupo: abre ventana, ambos responsables responden una sola entidad editable hasta deadline; la respuesta genera/actualiza salida planificada.
4. Conductor: recibe salida asignada, formulario precargado, reporta visitas; la primera persona queda como conductor responsable de la vuelta y el último informe sin pendientes la cierra.
5. Eventos: servicios emiten evento de dominio; workers idempotentes crean inbox/push/jobs/auditoría sin que componentes React creen notificaciones.

## Estrategia de migración sin pérdida de datos

1. Antes de cada migración, generar backup administrado de Supabase y exportar conteos/checksums mediante script versionado; registrar fecha, proyecto y resultado fuera del repositorio si contiene datos sensibles.
2. Introducir únicamente tablas/columnas/índices/constraints aditivos. No `DROP`, truncates ni recreación de tablas reales.
3. Backfill idempotente desde `profile_roles`/`profiles.role`, incluyendo mapeo `ADMIN -> ANCIANO + CONDUCTOR + COORDINADOR` solo como compatibilidad documentada. No se eliminan roles legacy.
4. Ejecutar script de verificación antes/después: conteos de perfiles, grupos, territorios, manzanas, reservas, salidas, visitas y vueltas; detectar perfiles sin condición V2, roles incongruentes y responsables inválidos.
5. Poner el nuevo servicio detrás de rutas/módulos V2, mantener V1 en lectura/escritura compatible durante la fase de convivencia.
6. Migrar un dominio por vez, comparar resultados y recién marcar V1 como deprecated. La eliminación futura requerirá un PR separado y evidencia de equivalencia.

### Rollback

- Las migraciones Fase 1 son aditivas; rollback funcional consiste en dejar de leer tablas V2 y conservarlas intactas.
- Nunca se revertirá mediante borrar filas de producción. Si una constraint nueva revela datos históricos incompatibles, se deshabilita su uso por aplicación y se corrige mediante una migración de reparación auditada.
- Todas las migraciones deberán ser transaccionales cuando Postgres lo permita; índices concurrentes, si fueran necesarios a escala, se planificarán fuera de transacción y se documentarán.

## Implementación por fases

0. Auditoría y este Master Plan.
1. Modelo de usuarios/permisos, migración aditiva, backfill, validación, auditoría y pruebas críticas.
2. AppShell/sidebar/cuenta y rutas V2.
3. Command Palette.
4. Eventos y notificaciones internas.
5. PWA, push y scheduler.
6. Planificación semanal workflow V2.
7. Conductores recurrentes y overrides.
8. Salida por Grupo, ventanas y reservas integradas.
9. Mis Salidas y formulario conductor.
10. Territory rounds y S-13 interno.
11. Mapa SVG interactivo.
12. No visitar.
13. Telefonía, Zoom y lluvia.
14. Anuncios.
15–18. Edificios, censado, departamentos/revisitas y vueltas.
19. Territorios personales.
20. Integración Google Docs S-13 staging primero.
21. Migración final, reconciliación, QA y retirada controlada de legacy.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Datos reales en una DB no accesible localmente | Scripts de backup/verification, SQL idempotente y revisión manual previa a aplicar |
| UI V1 depende de roles legacy | Adaptador legacy y backfill; no retirar `profile_roles` ni `profiles.role` en Fase 1 |
| Service role puede eludir RLS | Permisos en servicios/rutas, allowlists de payload, tests de policy; RLS como defensa adicional |
| Falta de transacciones en la API actual | Las nuevas operaciones sensibles usarán funciones SQL o servicios con outbox; migración gradual |
| Google Docs/Edificios externos no disponibles | Interfaces de integración y outbox, sin escribir datos externos ni inventar IDs |
| Zona horaria/horas heredadas en texto | Mantener legacy y convertir solo al crear/editar V2 con `America/Argentina/Buenos_Aires` |
| Cambios locales no relacionados | Commits V2 selectivos; no modificar ni incluir archivos ya sucios |

## Estrategia de pruebas y verificación

- TypeScript: `npx tsc --noEmit`.
- Lint: `npm run lint`.
- Build: `npm run build`; una fase no se declara completa si falla.
- Tests a introducir con la Fase 1 para incompatibilidad de condición, requisitos de responsabilidad y equivalencia legacy. Fases posteriores cubrirán algoritmo telefónico, rondas/S-13, scheduler, ventanas, deep links, revisitas, bloqueo y conflictos de censo.
- Validación SQL: verificador de conteos y de invariantes antes/después de migrar; el script no imprime secretos.
- Producción: backup, aplicación en staging/copia, verificación, y solo entonces producción.

## Checklist de Fase 0

- [x] Leer instrucciones, documentación, dependencias y configuración.
- [x] Inventariar app, rutas API, auth, componentes y dominio.
- [x] Revisar schema y todas las migraciones disponibles.
- [x] Identificar preservación/migración de tablas y riesgos.
- [x] Definir arquitectura, modelo de permisos, fases, rollback y pruebas.
- [x] Crear este documento antes de modificar código de producto.

## Open questions

No hay una decisión bloqueante para Fase 1. La equivalencia temporal `ADMIN` legacy a Coordinador V2 se implementará únicamente como puente de compatibilidad, documentada y auditable; no modifica ni elimina los datos legacy. IDs/URLs y credenciales de los dos Google Docs S-13, y el proyecto externo de edificios, quedan explícitamente fuera hasta las fases de integración correspondientes.
