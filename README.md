# Terris Grupo Selector

Aplicacion web para gestionar territorios de una congregacion: territorios
numerados, manzanas, vueltas anuales, grupos, usuarios ancianos/admin y reservas
de sabado/domingo.

## Stack

- Next.js + TypeScript para desplegar en Vercel.
- Supabase Postgres para datos, Row Level Security y reglas de backend.
- Autenticacion interna por usuario y contrasena con cookie HttpOnly.
- Tailwind CSS para UI administrativa.

## Configuracion

1. Crear un proyecto en Supabase.
2. Ejecutar `supabase/schema.sql` en el SQL editor de Supabase.
3. Si ya habias ejecutado la version anterior, ejecutar tambien `supabase/custom-auth-migration.sql`.
4. Copiar `.env.example` a `.env.local` o completar `.env`.
5. Completar:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SESSION_SECRET=
SUPER_ADMIN_USERNAME=DaSeselovsky
SUPER_ADMIN_PASSWORD=
```

El login inicial usa `SUPER_ADMIN_USERNAME` y `SUPER_ADMIN_PASSWORD`. La primera
vez que ese usuario ingresa, la app crea/actualiza el perfil super admin y
guarda la contrasena como hash en `public.profiles.password_hash`.

5. Instalar y correr:

```bash
npm install
npm run dev
```

## Reglas principales

- Un territorio tiene numero unico.
- Los territorios se cargan solo por numero; la app los muestra como territorios numerados.
- Una manzana pertenece a un territorio.
- Las manzanas se cargan con etiquetas simples como `M1`, `M2`, sin descripcion.
- Se pueden crear varias vueltas por ano, editarlas, cerrarlas o eliminarlas.
- El admin publica ventanas con fecha de sabado, domingo o ambas y una fecha limite.
- El grupo de una reserva se toma del usuario anciano; no se elige en el formulario.
- Cada respuesta incluye territorio y lugar de salida del grupo.
- Un anciano puede reservar varios territorios para el mismo dia.
- El selector muestra las manzanas pendientes cuando el territorio tiene avance parcial.
- Un territorio con todas sus manzanas completadas no se puede reservar.
- El anciano solo recibe sus reservas y no accede a estadisticas ni catalogos.
- El anciano solo puede editar o eliminar sus reservas antes de la fecha limite.
- El admin ve las respuestas por ventana y recibe avisos internos al crearse.
- No puede haber dos reservas activas del mismo territorio para la misma fecha.
- Una reserva activa crea un bloqueo automatico del territorio.
- Al completar, cancelar o vencer la reserva, el bloqueo se resuelve.
- El admin puede reabrir una reserva y su bloqueo se vuelve a crear.
- El avance se edita por manzana y cada registro de la vuelta puede eliminarse.
- Solo el admin administra catalogos, usuarios, territorios, manzanas y vueltas.
- Los usuarios pueden asignarse a un grupo.
- Las contrasenas temporales se muestran en modal y se copian automaticamente.

## Desarrollo actual

La primera pantalla es el login con usuario y contrasena internos. El dashboard
usa API routes de Next con cookie HttpOnly y Supabase service role en servidor;
el navegador no escribe directo en Supabase. El super admin gestiona usuarios,
puede escribir contrasenas manuales o generar temporales para ancianos.

## Comandos

```bash
npm run dev
npm run lint
npm run build
```

> Nota: Next 16 puede advertir si Node local esta por debajo de `22.13.0`.
> Para Vercel conviene configurar Node 22.13+ o 24.
