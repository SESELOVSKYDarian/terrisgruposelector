# Plan: rol Conductor, formulario de visitas y Salidas semanales

Basado en el código real de `terrisgruposelector` (Next.js 16 + Supabase, auth propia por cookie, un único `page.tsx` de ~2300 líneas con vistas por pestaña y un endpoint mega `app/api/app-data/route.ts` con `action` dispatch). No se toca el flujo de reservas de fin de semana (`territory_reservations`, "Ventanas") ni la "vuelta anual" global (`annual_rounds` / `block_round_statuses`) que ya usan los Ancianos para reservar — quedan intactos.

La idea central: todo esto vive **dentro de la misma app Next.js** que ya está pensada para Vercel (el README ya dice "Next.js + TypeScript para desplegar en Vercel"). No hace falta un servicio externo ni Google Apps Script: el "formulario externo tipo Vercel" es, literalmente, una pestaña/vista nueva de esta misma app, protegida por el nuevo rol. Si el proyecto todavía no está conectado a un proyecto de Vercel, ese es un paso de configuración (conectar el repo de GitHub a Vercel, cargar las variables de entorno que ya lista el README) que no depende del código.

---

## 1. Roles: agregar "Conductor" sin romper "Anciano"/"Admin"

**Problema real encontrado:** hoy `profiles.role` es un único enum (`ADMIN` | `ANCIANO`), no nulo, y toda la app decide qué pantalla mostrar con `isAdmin = profile.role === "ADMIN"` (un solo `if/else` en `page.tsx`). No hay lugar para "tiene además el rol Conductor" ni para "solo Conductor". Hace falta pasar de *un rol* a *una lista de roles* por usuario.

**Cambio de datos (`supabase/conductor-roles-migration.sql`, nuevo archivo de migración):**

```sql
alter type public.app_role add value if not exists 'CONDUCTOR';

create table public.profile_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, role)
);

-- migrar los roles actuales (todo usuario existente conserva su rol de hoy)
insert into public.profile_roles (profile_id, role)
select id, role from public.profiles
on conflict do nothing;

alter table public.profile_roles enable row level security;
create policy "profile_roles admin manage" on public.profile_roles for all using (false) with check (false);
```

`profiles.role` se deja como está por compatibilidad (nadie más lo necesita), pero la app deja de leerlo para decidir la pantalla: a partir de ahora todo se decide con el array de `profile_roles`.

**Backend (`src/lib/server/auth.ts`):**
- `SessionProfile.role: Role` → `SessionProfile.roles: Role[]`.
- El cookie firmado (`SessionPayload`) pasa a guardar `roles: Role[]` en vez de `role`.
- `getCurrentProfile()` deja de hacer `select ... role ...` de `profiles` y en su lugar hace un segundo `select role from profile_roles where profile_id = ...` (o se crea una vista `profiles_with_roles` que devuelve `roles` ya como array con `array_agg`, más prolijo para no duplicar la query en cada lugar).
- `assertAdmin(profile)` pasa a chequear `profile.roles.includes("ADMIN")`.
- Nuevos helpers: `isConductor(profile)`, `isAnciano(profile)`.

**Backend (`src/app/api/app-data/route.ts`):**
- Todo `profile.role !== "X"` pasa a `!profile.roles.includes("X")` (login, `createReservation`, `deleteReservation`, etc.).
- `createUser`/`updateUser`: el payload pasa de `role: "ADMIN" | "ANCIANO"` a `roles: string[]` (ej. `["ANCIANO", "CONDUCTOR"]` o `["CONDUCTOR"]` solo). Validar contra el set permitido y contra la regla "al menos un rol". Se guarda con un `delete + insert` (o upsert) en `profile_roles` dentro de la misma operación que crea/actualiza `profiles`.
- `deleteUser`: el chequeo "no se puede borrar un admin" pasa a `roles.includes("ADMIN")`.
- `login/route.ts`: el perfil que arma la cookie debe traer `roles` (mismo cambio que `getCurrentProfile`).

**Frontend (`src/lib/domain.ts` y `page.tsx`):**
- `roles` pasa a `["ADMIN", "ANCIANO", "CONDUCTOR"] as const`.
- `Profile.role: Role` → `Profile.roles: Role[]`.
- `isAdmin = profile?.roles.includes("ADMIN")`.
- Formulario de usuarios (línea ~1254 de `page.tsx`, hoy un `<select>` con dos opciones): pasa a **tres checkboxes** (Admin / Anciano / Conductor) en vez de un select — así se pueden marcar combinaciones. Validación en el submit: al menos un rol tildado.
- Tabla de usuarios (línea ~791): la columna "Rol" pasa a listar chips por cada rol que tenga el usuario (ej. "Anciano · Conductor").

**Shell de la app (`page.tsx`, línea ~356-410, hoy `isAdmin ? <AdminShell/> : <ElderReservations/>`):**
Pasa a resolver así:

```
si roles incluye ADMIN  → shell de Admin de siempre
  (opcional/no bloqueante: si ese admin también tiene CONDUCTOR, agregar una pestaña
  más "Actualizar territorio" al sidebar de Admin, reutilizando el mismo formulario)

si NO es admin:
  hasAnciano = roles.includes("ANCIANO")
  hasConductor = roles.includes("CONDUCTOR")

  si hasAnciano && hasConductor → header con dos pestañas simples ("Reservas" / "Actualizar
     territorio"), cambia entre <ElderReservations/> y <ConductorVisitForm/>
  si solo hasAnciano → exactamente lo que hay hoy, sin cambios visibles
  si solo hasConductor → se muestra directo <ConductorVisitForm/> como contenido principal
     (el header deja de decir "Reservas de mi grupo" / no exige grupo asignado)
  si no tiene ningún rol → mensaje "No tenés secciones asignadas, contactá al administrador"
```

Esto cubre exactamente lo pedido: Conductor se puede sumar a Anciano, o existir solo, sin romper el caso actual (Anciano solo).

---

## 2. Historial de asignaciones por territorio (el "S-13" real)

**Por qué hace falta una tabla nueva:** la tabla que ya existe (`annual_rounds` + `block_round_statuses`) es una **vuelta global** de toda la congregación (una sola activa a la vez, con fecha de cierre única para todos los territorios). Lo que pediste — conductor + fecha asignada + fecha completada, por territorio, con posibilidad de que quede "abierta" mientras hay manzanas pendientes — es un **ciclo por territorio**, independiente de esa vuelta global. Son dos conceptos distintos y no conviene mezclarlos (la vuelta global sigue alimentando la pantalla de reservas de los Ancianos tal cual hoy).

**Tabla nueva `territory_rounds`** (una fila = una asignación de un territorio a un conductor, "vuelta" en el sentido S-13):

```sql
create table public.territory_rounds (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  conductor_id uuid not null references public.profiles(id),
  assigned_on date not null,
  completed_on date,
  pending_block_labels text[] not null default '{}',
  done_block_labels text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- solo puede haber UNA vuelta abierta por territorio a la vez
create unique index one_open_round_per_territory
  on public.territory_rounds(territory_id)
  where completed_on is null;
```

**Tabla opcional `territory_visits`** (log de cada envío del formulario, útil para auditoría/historial — no es indispensable para que la lógica funcione, se puede sumar después):

```sql
create table public.territory_visits (
  id uuid primary key default gen_random_uuid(),
  territory_round_id uuid not null references public.territory_rounds(id) on delete cascade,
  conductor_id uuid not null references public.profiles(id),
  visit_date date not null,
  done_labels text[] not null default '{}',
  pending_labels text[] not null default '{}',
  created_at timestamptz not null default now()
);
```

### Lógica exacta de guardado (mi interpretación de tu regla, para que la confirmes)

Cada envío manda: `{territorio, fecha, hechas[], pendientes[]}` — el conductor **no** se manda desde el cliente, se toma del usuario logueado (ver punto 4).

```
buscar vuelta abierta del territorio (completed_on is null)

si TODO se completó esta visita (pendientes vacío):
  si hay vuelta abierta → cerrarla: completed_on = fecha de esta visita.
                          NO se toca conductor_id ni assigned_on.
  si NO hay vuelta abierta → crear una nueva: conductor_id = yo, assigned_on = fecha,
                          completed_on = fecha (misma fecha en las dos columnas).

si algo queda pendiente:
  si hay vuelta abierta → el envío es un no-op sobre "asignado a" / "fecha asignada"
                          (no se tocan, tal cual pediste). Lo que SÍ se actualiza siempre
                          es la lista de manzanas pendientes/hechas de la vuelta (si no,
                          "Salidas semanales" nunca podría mostrar "11(M3-M4)" actualizado).
  si NO hay vuelta abierta → crear una nueva vuelta: conductor_id = yo, assigned_on = fecha,
                          completed_on = null, pendientes = lo que llegó.
```

**Punto a confirmar:** entendí que "no se guarda nada, ni siquiera el nombre del asignado a" se refiere solo a las columnas "Asignado a" / "Fecha en que se asignó" (para no pisar la fecha de asignación original con cada visita parcial) — pero que el estado de manzanas (qué quedó pendiente) sí se sigue actualizando en cada visita, porque si no, no hay forma de que el sistema sepa qué falta. Si en realidad querías que la visita entera se descarte (ni siquiera actualizar manzanas) avisame y cambio esa parte.

---

## 3. Formulario del Conductor

Nueva vista `ConductorVisitForm`, visible para cualquier perfil con `roles.includes("CONDUCTOR")` (según el punto 1).

**Campos:**
- **Conductor**: no es un campo editable. Se muestra de solo lectura ("Vas a registrar esta visita como **{full_name}** (@{username})") y el backend usa `profile.id` de la sesión, nunca un valor del formulario. Así se cumple "que no lo tengan que completar" y no aparece ningún nombre de ejemplo ajeno en los placeholders.
- **Territorio**: selector (no input numérico libre), listando los territorios activos con el mismo formato que ya usa la app en otros lados (`Territorio #N` + "Faltan M3, M4" si tiene vuelta abierta, reutilizando la función `territorySelectionLabel` que ya existe en `page.tsx`). Los territorios con vuelta abierta asignada a este mismo conductor aparecen primero, como ayuda.
- **Fecha**: `<input type="date">`, default hoy (igual que el formulario viejo de Apps Script).
- **Manzanas**: grilla visual — ver punto siguiente, reutilizando el componente del admin.

**Reutilización real del selector visual del admin (pedido explícito):**
El selector de manzanas que ya existe hoy en `page.tsx` (función alrededor de la línea 1420–1470, el modal "Manzanas del territorio") es una grilla de botones cuadrados por manzana, con estado toggle (pendiente = gris / completa = verde), más "Todas"/"Limpiar". Se extrae ese bloque a un componente compartido `BlockToggleGrid({ blocks, selectedIds, onToggle })` en `src/app/_components/block-toggle-grid.tsx` (mismas clases Tailwind, mismos colores `emerald`/`teal`, mismo `rounded-2xl` — cero diferencia visual) y se usa en dos lugares:
1. El modal de Admin (como hoy, sin cambios de comportamiento).
2. El formulario de Conductor: al elegir un territorio, la grilla se precarga con las manzanas pendientes conocidas (de la vuelta abierta, si existe; si no hay vuelta abierta, se muestran todas las manzanas del territorio como pendientes). El conductor toca las que **completó en esta visita** (pasan a verde); las que quedan sin tocar son las "pendientes" que se mandan en el envío.

**Diseño:** mismo `glass-panel`, mismos botones (`primaryButtonClass`, `inputClass`, etc. ya definidos en `page.tsx`), mismo fondo `--background: #091110` con acento `teal-300`, misma tipografía y animaciones (`view-transition`, `modal-enter`) del resto del sitio — nada de un formulario "aparte" con otro estilo.

---

## 4. Endpoint nuevo

Se agrega una acción más al mismo patrón que ya usa la app (`POST /api/app-data` con `{action, payload}`), en vez de inventar una ruta nueva, para no romper la convención existente:

- `action: "submitTerritoryVisit"`, payload `{territory_id, visit_date, done_labels, pending_labels}`.
- Requiere `profile.roles.includes("CONDUCTOR")` (no requiere ser Anciano ni Admin).
- Implementa la lógica del punto 2.
- `GET /api/app-data` también necesita devolver, para estos perfiles, la lista de territorios + su vuelta abierta actual (algo como `territoryRounds: {territory_id, conductor_id, assigned_on, pending_block_labels}[]`), del mismo modo que hoy ya arma `territoryProgress` para la vista de reservas.

---

## 5. Salidas semanales (nueva sección de Admin)

Nuevas tablas:

```sql
create table public.weekly_outings (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,          -- siempre un jueves
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_outing_starts_thursday check (extract(isodow from starts_on) = 4)
);
-- ends_on = starts_on + 6 (miércoles) se calcula, no se guarda, así nunca queda desincronizado.
-- el título "Salidas del 27 de Agosto al 2 de Septiembre" también se calcula en el front
-- a partir de starts_on, con los nombres de mes en español.

create table public.weekly_outing_slots (
  id uuid primary key default gen_random_uuid(),
  weekly_outing_id uuid not null references public.weekly_outings(id) on delete cascade,
  slot_date date not null,          -- día concreto dentro de la semana (jueves..miércoles)
  sort_order integer not null default 0,
  hora text,                        -- editable libre (input type="time" en la UI)
  lugar text,                       -- editable libre
  conductor_id uuid references public.profiles(id),
  highlighted boolean not null default false,   -- para filas especiales tipo "GRUPO 3"
  note text,                        -- texto libre de la fila especial, si aplica
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.weekly_outing_slot_territories (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.weekly_outing_slots(id) on delete cascade,
  territory_id uuid not null references public.territories(id),
  territory_round_id uuid references public.territory_rounds(id),  -- qué vuelta de ese territorio
  sort_order integer not null default 0,
  display_override text   -- por si el admin quiere escribir algo manual (ver nota abajo)
);
```

**Por qué esta forma:** cada celda "Terr." puede tener varios territorios (se unen con "+" al mostrarlos, en el orden de `sort_order`), y cada territorio-dentro-de-la-celda apunta a una `territory_round_id` puntual — así el mismo territorio puede aparecer dos veces en la semana referenciando **vueltas distintas** (una vieja ya cerrada y una nueva abierta, por ejemplo), que es literalmente lo que pediste ("que pueda seleccionar de distintas vueltas el terri"). El selector de territorio no se limita a "solo si tiene vuelta abierta": se puede elegir cualquier territorio activo, y si la vuelta elegida (o la vuelta abierta más reciente, si no se especifica otra) tiene manzanas pendientes, se autocompleta el texto "N(Mx-My)"; si no tiene pendientes registradas, se muestra solo el número.

**Punto a confirmar (no lo pude deducir con certeza de la descripción):** en tu ejemplo aparecen sufijos como `*` (ej. "36*") y `Cont` (ej. "16Cont", "25Cont+28") que no tengo forma de inferir con seguridad qué significan exactamente (¿"*" = recién asignado sin manzanas específicas todavía? ¿"Cont" = "continúa" la misma vuelta de la semana anterior?). Para no adivinar mal, dejé el campo `display_override` como escape: el sistema arma automáticamente "N(Mx-My)" según las manzanas pendientes reales, pero el admin puede editar/completar ese texto a mano en la celda (agregar el `*` o `Cont` si corresponde) sin perder la selección real de territorio/vuelta por debajo. Si me confirmás el significado exacto, lo puedo automatizar del todo más adelante.

**Formato automático "N(Mx-My)":** función `formatPendingBlocks(labels: string[])` que ordena numéricamente, agrupa manzanas consecutivas en rangos (`M3,M4` → `M3-M4`) y separa grupos no consecutivos con coma (`M3-M4,M7`), igual al patrón del ejemplo.

**Pantalla de Admin:**
- Nueva pestaña "Salidas semanales" en el sidebar (`AdminNav`, junto a "Vueltas"/"Territorios").
- Selector "Desde" (solo jueves habilitados) / calcula "Hasta" solo; título se genera y se muestra en vivo arriba de la tabla, formato "Salidas del {día} de {Mes} al {día} de {Mes}" con meses en español.
- Los 7 días (Jueves→Miércoles) se listan siempre como grupos fijos, cada uno con sus filas de horario; "Agregar salida" dentro de cada grupo de día crea una fila nueva (`weekly_outing_slots`) con `sort_order` siguiente.
- Cada fila: Hora (input de hora libre), Conductor (`<select>` poblado solo con perfiles que tengan `roles.includes("CONDUCTOR")`, sin restricción de unicidad — el mismo conductor se puede repetir en varias filas/días), Lugar (texto libre), Terr. (selector multi-territorio con autoformato descrito arriba), más un toggle "Destacar fila" para las filas tipo "GRUPO 3" (fondo distinto, mismo recurso visual que ya usa la app para estados con color).
- CRUD completo: crear/editar/eliminar filas y celdas de territorio, eliminar toda la semana. Todo vía la misma acción `mutate(action, payload)` de siempre, agregando acciones `createWeeklyOuting`, `updateWeeklyOutingSlot`, `deleteWeeklyOutingSlot`, `setSlotTerritories`, etc.
- Diseño: tabla agrupada por día con encabezados sticky, filas alternadas (`bg-white/[0.02]` / transparente) y la fila destacada con el mismo tratamiento de acento (`border-teal-300/25 bg-teal-400/[0.06]`) que ya usan otras franjas de la app — visualmente cercano a la planilla de la imagen pero con la paleta oscura del sitio en vez de la grilla blanca de Excel.

---

## 6. Orden de implementación sugerido

1. Migración de roles (`profile_roles`, tipos, `auth.ts`, cookie) + UI de usuarios con checkboxes. Probar que un usuario Conductor-only puede loguearse y ve la pantalla vacía correcta antes de seguir.
2. Tabla `territory_rounds` (+ `territory_visits` opcional) + acción `submitTerritoryVisit` + `GET /api/app-data` extendido.
3. `BlockToggleGrid` compartido + `ConductorVisitForm` + enrutamiento del shell según roles (punto 1, última parte).
4. Tablas `weekly_outings` / `weekly_outing_slots` / `weekly_outing_slot_territories` + pestaña de Admin con el CRUD completo.
5. Deploy: conectar el repo a un proyecto de Vercel (si no lo está ya) con las mismas variables de entorno que pide el README (`SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `SESSION_SECRET`, `SUPER_ADMIN_*`).

## 7. Cosas que quedan fuera de este alcance (a menos que lo pidas)

- No se modifica el flujo de "Ventanas"/reservas de sábado-domingo de los Ancianos.
- No se toca `annual_rounds`/vuelta global ni la vista de progreso que usan las reservas.
- No se recrea una "vista S-13" de 4 rondas por territorio dentro de la app (los documentos de Google Docs viejos quedan como estaban); si la querés como pantalla de consulta dentro del sitio, se puede armar después a partir de `territory_rounds` sin cambios de esquema.
- Los dos Google Docs y el Apps Script de la iteración anterior quedan obsoletos con este enfoque — se pueden borrar cuando quieras, ya no hace falta mantenerlos sincronizados.

## 8. Para confirmar antes de programar

1. La interpretación de la regla de "no guardar nada" (§2) — ¿el estado de manzanas pendientes se sigue actualizando en cada visita aunque no se toque "asignado a"/"fecha asignada"?
2. Significado exacto de `*` y `Cont` en la columna Terr. de Salidas semanales (§5) — mientras tanto quedan como texto editable a mano.
3. Si el proyecto ya está conectado a Vercel o hay que conectarlo de cero.
4. Si un Admin que también es Conductor debería ver el formulario de visita dentro del panel de Admin (lo dejé como opcional/no bloqueante).
