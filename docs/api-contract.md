# Contrato de API y cliente cloud — Semana 05

Fuente del contrato del servidor: `docs/CAMPUSOPS_API.md` y `course-backend/campusops.mjs`. Todos los datos, actores y el token `course-valid-token` son fixtures públicos del backend didáctico, no credenciales.

## 1. Límite entre DTO, dominio y errores

| Capa | Tipo | Archivo |
|---|---|---|
| Transporte (DTO) | `IncidentResourceDto`, `IncidentListResponseDto`, `CreateIncidentRequestDto`, `CreateIncidentResponseDto` | `src/infrastructure/api/incidentDtos.ts` |
| Validación del sobre | `parseRemoteResource` → `ParseResult` | `src/infrastructure/api/remoteResource.ts` |
| Cliente HTTP | `HttpIncidentRepository` | `src/infrastructure/api/HttpIncidentRepository.ts` |
| Errores | `IncidentApiError` (`kind` discriminado) | `src/infrastructure/api/IncidentApiError.ts` |
| Dominio | `Incident` | `src/domain/incidents/Incident.ts` (sin cambios) |

- **DTOs:** el cliente sólo devuelve DTOs cuyo sobre ya se validó y nunca devuelve la respuesta cruda.
- **Mapeo a dominio:** la conversión DTO → `Incident` y la conexión con los casos de uso y la UI quedan fuera de este cliente.
- **Adaptador evaluable:** `src/course-evaluation/index.ts#parseRemoteResource` delega en el mismo parser que usa el cliente.

## 2. Solicitudes

Todas las rutas envían `Authorization: Bearer <token de sesión>` y `X-Course-Actor: <actorId>`. `X-Course-Scenario` sólo se envía cuando se configura `scenario` para pruebas.

| Método del cliente | Ruta | Cuerpo enviado | Devuelve |
|---|---|---|---|
| `getAll()` | `GET /v1/incidents` | — | `IncidentListResponseDto` (`{ items }`) |
| `getById(id)` | `GET /v1/incidents/:id` | — | `IncidentResourceDto`, o `null` si es 404 |
| `create(body, idempotencyKey)` | `POST /v1/incidents` + `Idempotency-Key` | `{ category, description, location }` | `CreateIncidentResponseDto` (`{ incident, operationId, duplicate }`) |

La clave de idempotencia la provee quien invoca al cliente. Debe tener al menos 8 caracteres y ser la misma al repetir un envío. Con la misma clave, el servidor devuelve la misma incidencia con `duplicate: true` y no crea otra.

## 3. Validación del sobre (`parseRemoteResource`)

- Objeto plano con `id` y `status` como cadenas no vacías.
- `version` entero mayor o igual a 0.
- `payload` objeto o `null`; nunca arreglo ni primitivo.
- Copia sólo esos cuatro campos e ignora los campos futuros del sobre (compatibilidad hacia adelante).
- Cualquier otra forma devuelve `{ ok: false, error: 'contract' }`. En el cliente eso se convierte en `ContractViolationError`.

Un `payload: null` es válido en el transporte y se entrega tal cual. Quien construya el dominio no debe inventar datos a partir de él ni tratarlo como formato inválido.

## 4. Errores tipados (`IncidentApiError.kind`)

| `kind` | Origen |
|---|---|
| `NetworkError` | `fetch` rechazado sin abort, o respuesta sin código HTTP (status 0) |
| `TimeoutError` | El cliente aborta a los 5000 ms (configurable con `timeoutMs`) |
| `ContractViolationError` | Sobre inválido, lista sin `items`, respuesta de creación incompleta o JSON malformado; también cualquier excepción inesperada al interpretar la respuesta |
| `UnauthorizedError` | HTTP 401 / 403 |
| `RateLimitedError` | HTTP 429 |
| `ServerError` | HTTP ≥ 500 |
| `RejectedError` | Otro 4xx (p. ej. 409, 422) |

El mensaje del error es fijo (`incident_api_<kind>`). No lleva la URL, el puerto, el cuerpo de la respuesta ni la causa original.

## 5. Registros

En cada falla el cliente emite `incident_api_failed { operation, kind, status, durationMs }` vía `logSafeTelemetry` (sanitizado por `redactForTelemetry`). No se registran el token, la URL ni el contenido de la incidencia.

## 6. Pruebas sin Internet público

- **Prueba pública:** `course-tests/public/week-05.test.ts` cubre el sobre publicado.
- **Inyección de `fetch`:** el cliente acepta `fetchImpl`, así que puede probarse con dobles deterministas o contra el backend didáctico local (`make run-backend`), usando las variantes de `X-Course-Scenario` vía la opción `scenario`.
- **Polyfill de Expo:** en Jest, el preset `jest-expo` reemplaza el `fetch` global por el polyfill de Expo, que no funciona en Node. Las pruebas de integración deben inyectar un transporte de Node.
