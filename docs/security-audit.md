# Auditoría de seguridad — Semana 4

- **Nombre:** José Miguel
- **Grupo:** 10A
- **Repositorio:** https://github.com/Breyan21/CampusOps-E07
- **Rama:** `week4/security-audit-JoseMiguel`
- **Modalidad:** Individual
- **Fecha:** 2026-09-24

Se revisó el proyecto CampusOps (React Native + Expo + TypeScript) desde el rol de una persona encargada de una auditoría básica de seguridad. Para cada hallazgo se siguió la cadena **Problema → Riesgo → Corrección → Evidencia**. Todos los datos usados son ficticios (fixtures didácticos del curso); no se publicó ninguna credencial real.

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | Tokens de sesión escritos directamente en el código del backend didáctico (`course-valid-token`, `course-refresh-0`) en `course-backend/server.mjs` y `course-backend/campusops.mjs` | Cualquier persona con acceso al repositorio puede leer y reutilizar los tokens; además, el patrón se puede replicar por error con credenciales reales | Se centralizaron en `course-backend/fixtures.mjs` y ahora se leen de variables de entorno (`COURSE_FIXTURE_TOKEN`, `COURSE_FIXTURE_REFRESH_TOKEN`, `COURSE_FIXTURE_REFRESH_TOKEN_NEXT`); los nombres se documentan en `.env.example` sin valores reales | `docs/evidence/token-corregido.png` |
| 2 | Se imprimía el objeto de error completo en consola con `console.error(err)` en `src/ui/incidents/IncidentListScreen.tsx` y `src/ui/incidents/IncidentDetailScreen.tsx` | Los logs podían revelar accidentalmente detalles técnicos, URLs o datos personales si el error los contenía | Se reemplazó por mensajes sanitizados y fijos que no exponen el objeto de error (`"No fue posible cargar las incidencias."` y `"No fue posible cargar el detalle de la incidencia."`) | `docs/evidence/logs-sanitizados.png` |
| 3 | El proyecto no contaba con una función de sanitización de datos personales para telemetría/logs: `redactForTelemetry` estaba pendiente en `src/course-evaluation/index.ts` | Datos personales, tokens y ubicaciones podían registrarse sin redactar antes de enviarse a telemetría o logs | Se implementó `redactForTelemetry`: recorre objetos/listas sin mutar la entrada y sustituye por `[REDACTED]` las claves sensibles (token, email, nombre, ubicación, evidencia, etc.) conservando el contexto técnico | `docs/evidence/redact-telemetry.png` |

---

## Hallazgo 1 — Tokens de sesión escritos directamente en el código

### Problema encontrado

Dentro del backend didáctico, los valores de sesión `course-valid-token`, `course-refresh-0` y `course-refresh-1` estaban escritos como literales directamente en el código fuente, tanto en la verificación de autorización como en las respuestas de login/refresh:

- `course-backend/campusops.mjs` (login y verificación de `Authorization`).
- `course-backend/server.mjs` (ruta `/v1/resources` y `/v1/session/refresh`).

Estos valores son fixtures públicos del curso (no credenciales reales), pero la forma de escribirlos es exactamente el patrón que expone secretos: una cadena sensible incrustada en el código que queda en el repositorio y en el historial de Git.

### Riesgo

Cualquier persona con acceso al repositorio puede leer los tokens y autenticarse contra el backend sin autorización. Además, el patrón invita a que un cambio futuro reemplace estos literales por una credencial real y quede publicada en el repositorio, exponiéndola a cualquiera que clone el proyecto.

### Solución

Se movieron los tokens a un módulo de configuración `course-backend/fixtures.mjs` que los lee de variables de entorno con valores ficticios por defecto. El comportamiento del backend no cambia para el entorno didáctico (los defaults son los mismos fixtures), pero ahora existe una vía segura para sobreescribirlos sin tocar el código. Los nombres de las variables quedaron documentados en `.env.example`, que sólo sube al repositorio porque NO contiene credenciales.

### Antes

```js
// course-backend/server.mjs
if (request.headers.authorization !== 'Bearer course-valid-token') {
  return send(response, 401, { code: 'unauthorized' });
}
```

```js
// course-backend/campusops.mjs
return send(response, 200, {
  actorId: input.actorId,
  role: actors[input.actorId],
  accessToken: 'course-valid-token',
  refreshToken: 'course-refresh-0',
  expiresIn: 60,
});
```

### Después

```js
// course-backend/fixtures.mjs
const env = process.env;

export const FIXTURE_ACCESS_TOKEN = env.COURSE_FIXTURE_TOKEN ?? 'course-valid-token';
export const FIXTURE_REFRESH_TOKEN = env.COURSE_FIXTURE_REFRESH_TOKEN ?? 'course-refresh-0';
export const FIXTURE_REFRESH_TOKEN_NEXT = env.COURSE_FIXTURE_REFRESH_TOKEN_NEXT ?? 'course-refresh-1';
```

```js
// course-backend/server.mjs
if (request.headers.authorization !== `Bearer ${FIXTURE_ACCESS_TOKEN}`) {
  return send(response, 401, { code: 'unauthorized' });
}
```

```js
// course-backend/campusops.mjs
return send(response, 200, {
  actorId: input.actorId,
  role: actors[input.actorId],
  accessToken: FIXTURE_ACCESS_TOKEN,
  refreshToken: FIXTURE_REFRESH_TOKEN,
  expiresIn: 60,
});
```

```bash
# .env.example (sólo nombres, sin valores reales)
EXPO_PUBLIC_COURSE_BACKEND_URL=http://127.0.0.1:4310
COURSE_FIXTURE_TOKEN=
COURSE_FIXTURE_REFRESH_TOKEN=
COURSE_FIXTURE_REFRESH_TOKEN_NEXT=
```

### Evidencia

`docs/evidence/token-corregido.png` — diff real de `git diff -- course-backend/` mostrando la eliminación de los literales y su reemplazo por `FIXTURE_ACCESS_TOKEN`/`FIXTURE_REFRESH_TOKEN`, más el contenido de `.env.example`. La corrección quedó verificada además con `npm run backend:self-test` (PASS).

---

## Hallazgo 2 — Objetos de error completos enviados a consola

### Problema encontrado

Las dos pantallas de incidencias usaban `console.error(err)` dentro del `.catch(...)` de las promesas:

- `src/ui/incidents/IncidentListScreen.tsx`
- `src/ui/incidents/IncidentDetailScreen.tsx`

`console.error(err)` imprime el objeto de error completo. Si un error remoto alguna vez contiene la URL del servicio, encabezados de autorización, parámetros de la petición o datos personales de una incidencia, todo eso quedaría registrado en los logs de la aplicación.

### Riesgo

Los logs son un canal de exportación silencioso: una vez que el error se registra, queda en consola, en herramientas de telemetría y en reportes de soporte. Imprimir el objeto completo puede revelar información sensible que no fue estrictamente necesaria para depurar.

### Solución

Se reemplazó el volcado del objeto por un mensaje fijo y sanitizado que conserva el contexto funcional (qué falló y dónde) sin exponer el detalle del error. Para depuraciones futuras se cuenta con `redactForTelemetry` (Hallazgo 3) que permite registrar contexto técnico de forma segura.

### Antes

```tsx
}).catch((err: unknown) => {
  console.error(err);
  if (mounted) setLoading(false);
});
```

### Después

```tsx
}).catch(() => {
  console.error('No fue posible cargar las incidencias.');
  if (mounted) setLoading(false);
});
```

```tsx
}).catch(() => {
  console.error('No fue posible cargar el detalle de la incidencia.');
  if (mounted) setLoading(false);
});
```

### Evidencia

`docs/evidence/logs-sanitizados.png` — diff real de `git diff -- src/ui/incidents/*.tsx` y el grep posterior que confirma que ya no queda ningún `console.error(err)` con el objeto completo en las pantallas.

---

## Hallazgo 3 — Faltaba sanitización de datos personales antes de logs/telemetría

### Problema encontrado

El módulo `src/course-evaluation/index.ts` declaraba `redactForTelemetry` como una función pendiente (lanzaba `pending('redactForTelemetry')`). El proyecto no contaba con ninguna utilidad para redactar datos personales y sensibles antes de enviarlos a telemetría o registros.

### Riesgo

Sin una función de redacción, cualquier integración futura de telemetría o registro podría capturar tokens, correos, nombres, ubicaciones, fotografías o comentarios internos tal cual, exponiendo información privada en logs y herramientas de monitoreo.

### Solución

Se implementó `redactForTelemetry`: recorre objetos y listas **sin mutar la entrada**, normaliza cada clave a minúsculas y sin guiones/guiones bajos, y sustituye por `[REDACTED]` el **valor completo** cuando la clave es sensible (`authorization`, `password`, `token`, `accessToken`, `refreshToken`, `email`, `displayName`, `name`, `userId`, `reporterId`, `technicianId`, `assignedTechnicianId`, `location`, `latitude`, `longitude`, `photos`, `evidence`, `internalComments`, `assignmentHistory`). Los campos técnicos no sensibles (`incidentId`, `correlationId`, `status`, `attempt`, `durationMs`, etc.) se conservan para mantener el contexto útil al depurar.

### Antes

```ts
export function redactForTelemetry(_input: unknown): unknown {
  return pending('redactForTelemetry');
}
```

### Después

```ts
export function redactForTelemetry(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => redactForTelemetry(item));
  }
  if (input !== null && typeof input === 'object') {
    const cloned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Readonly<Record<string, unknown>>)) {
      cloned[key] = SENSITIVE_KEYS.has(normalizeKey(key))
        ? '[REDACTED]'
        : redactForTelemetry(value);
    }
    return cloned;
  }
  return input;
}
```

### Verificación

La prueba pública de la semana 4 comprueba que la función redacta los datos personales y sensibles de una incidencia y **conserva el contexto técnico**. Ejecución real:

```bash
npm test -- --ci --runInBand course-tests/public/week-04.test.ts
```

Resultado: `PASS` — `CampusOps redacts personal and incident-sensitive data while preserving technical context`.

### Evidencia

`docs/evidence/redact-telemetry.png` — salida real de la prueba pública de la semana 4 (PASS) y el fragmento de la implementación en `src/course-evaluation/index.ts`.

---

## Comprobación final

Antes de cerrar se verificó que ningún secreto se sube al repositorio:

```bash
git check-ignore -v .env
# .gitignore:8:.env	.env

git status --short
# sólo los archivos de la auditoría aparecen como modificados

git ls-files
# .env.example (sí rastreado, sin credenciales) ; .env (no aparece)
```

- `.gitignore` ya incluye `.env` (línea 8).
- No existe un archivo `.env` en el repositorio ni está rastreado por Git.
- `.env.example` sólo documenta nombres de variables, sin credenciales reales.

Evidencia: `docs/evidence/gitignore-env.png`.

## Checklist

- [x] Se creó/validó la rama `week4/security-audit-JoseMiguel`.
- [x] Se creó `docs/security-audit.md`.
- [x] Se identificaron 3 problemas reales del proyecto.
- [x] Se explicó el riesgo de cada uno.
- [x] Se corrigieron 3 problemas (mínimo 2 requeridos).
- [x] Se generó evidencia de cada corrección.
- [x] Las evidencias se guardaron en `docs/evidence/` con nombres claros.
- [x] Se revisó `.gitignore`.
- [x] Se verificó que `.env` no se sube.
- [x] No se publicaron contraseñas ni tokens reales.
- [x] Comprobaciones del proyecto intactas: `npm run typecheck` (PASS), `npm run lint` (PASS), `npm run backend:self-test` (PASS), `npm run test:smoke` (PASS).

## Datos para la entrega en Classroom

```text
Nombre: José Miguel
Grupo: 10A
Repositorio: https://github.com/Breyan21/CampusOps-E07
Rama: week4/security-audit-JoseMiguel
Commit final: <SHA del commit> (se completa tras el commit final)
```