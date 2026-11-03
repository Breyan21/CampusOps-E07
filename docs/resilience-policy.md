# Política de resiliencia de CampusOps

## Objetivo y alcance

Esta política establece cómo representar una ubicación cuando la geocodificación
no produce datos utilizables y cómo decidir reintentos HTTP acotados. El objetivo
es permitir que una incidencia conserve una referencia escrita por el usuario
sin depender de que un servicio externo esté disponible, y evitar reintentos que
generen esperas inválidas o dupliquen operaciones de escritura.

Los contratos de dominio y las funciones puras se implementan en
`src/domain/location/types.ts` y `src/course-evaluation/index.ts`. La solicitud
de red, la caché en memoria y la interfaz corresponden a `GeocodingService.ts`,
`HttpIncidentRepository.ts` y la interfaz de usuario en `IncidentListScreen.tsx`.

## Proveedor externo y límites

El proyecto todavía no identifica un proveedor externo real de mapas o
geocodificación en producción comercial. La selección del servicio definitivo,
sus cuotas, términos de uso, retención de consultas y configuración de
credenciales quedan pendientes de confirmación del equipo; esta política no
atribuye una cuota comercial ni una integración propietaria a ningún proveedor.

El backend del curso ofrece `GET /v1/geocoding?q=...` como doble determinista
para pruebas y evaluación académica. Devuelve ubicaciones sintéticas y escenarios
controlados, incluidos 429 con `Retry-After`, datos incompletos y coordenadas
inválidas. No consulta lugares reales, no sustituye al proveedor de producción
y no debe exponerse a Internet. Toda integración real dependerá de conectividad
y deberá evitar enviar datos personales en las consultas; sólo se usarán
referencias sintéticas durante las pruebas del curso.

Hasta que se seleccione un proveedor final, se documentan los límites observados
en el entorno controlado y las salvaguardas implementadas: tiempos máximos de
espera acotados (3000 ms por defecto en geocodificación), reintentos limitados
y fallback manual inmediato ante contingencias.

## Estrategia de caché

El adaptador `GeocodingService` implementa una caché en memoria indexada por
consulta normalizada (`query.trim().toLowerCase()`). Sus propiedades y reglas
operativas son:

- **Clave normalizada:** Convierte el texto de búsqueda a minúsculas y colapsa
  espacios en blanco superfluos para maximizar los aciertos en caché ante ligeras
  variaciones tipográficas o de espaciado introducidas por el usuario.
- **TTL acotado:** Conserva las entradas válidas durante un TTL de 5 minutos
  (`DEFAULT_CACHE_TTL_MS = 300_000`), evitando consultas redundantes hacia el
  proveedor externo y reduciendo el consumo de cuota y latencia.
- **Solo resultados válidos:** Únicamente se almacenan en caché respuestas
  exitosas con `source: 'provider'` que cumplen todas las validaciones de
  coordenadas y etiqueta en `selectIncidentLocation`.
- **Aislamiento de fallos:** Errores de transporte, desconexión, respuestas 429,
  timeouts y fallbacks manuales NUNCA se almacenan como ubicaciones válidas en la
  caché.
- **Resiliencia ante degradación:** Ante una respuesta 429 o falla transitoria de
  red, si existe un resultado previo en caché para la consulta, se utiliza como
  contingencia temporal; en ausencia de caché previa, se activa el fallback manual.
- **Volatilidad:** Al residir en memoria (`Map<string, CacheEntry>`), la caché se
  reinicia limpiamente al reiniciar el proceso de la aplicación, garantizando que
  no persistan estados corruptos o desactualizados entre sesiones.

## Fallback manual

`selectIncidentLocation(provider, manualLabel)` acepta únicamente un objeto con
etiqueta no vacía y latitud/longitud numéricas, finitas y dentro de
[-90, 90]/[-180, 180], respectivamente. Los valores cero son válidos. Si el
valor externo es nulo, incompleto, malformado, tiene tipos incorrectos o
coordenadas inválidas, devuelve `{ source: 'manual', label: manualLabel }`.
La ubicación manual no contiene coordenadas: nunca se inventan ni se asignan
valores predeterminados. La etiqueta manual no vacía es una precondición; la
función la comprueba y lanza `TypeError` si falta o sólo contiene espacios, en
lugar de inventar una etiqueta alternativa.

La función recibe datos y no efectúa solicitudes ni captura excepciones de red.
Un timeout, una desconexión o un estado HTTP 429 se capturan en el adaptador
`GeocodingService` y se traducen a un resultado no disponible; entonces la
interfaz permite escribir un edificio, zona o referencia textual. La selección
manual permite continuar con el reporte de la incidencia cuando el resto de sus
datos sea válido sin bloquear al usuario.

## Política de reintentos

`planRetry` es determinista. Considera recuperables el timeout y los estados
HTTP enteros 408, 425, 429 y 500–599. Los demás estados son terminales para esta
política. La configuración interna tipada `RETRY_POLICY` centraliza
`maxAttempts: 4` y `baseDelayMs: 500`; se puede ajustar en el módulo sin cambiar
la firma pública de `planRetry`. Sólo programa un reintento si el intento actual
es un entero entre 1 y 3; desde el intento 4 no programa otro. Por tanto,
contando la solicitud inicial, puede haber como máximo cuatro intentos (intento
inicial y hasta 3 reintentos). Esta configuración es de código, no una opción de
runtime ni una preferencia del usuario.

Para errores recuperables sin un `Retry-After` válido, el retraso es un backoff
exponencial de 500 ms multiplicado por `2^(attempt - 1)` (500 ms, 1000 ms, 2000 ms).
La función no añade jitter, por lo que su resultado es reproducible. Un
`retryAfterMs` numérico, finito y no negativo prevalece sobre el backoff y se
conserva exactamente, incluidos valores fraccionarios o muy grandes. Valores
ausentes, negativos, `NaN` o infinitos no se consideran válidos y se usa el
backoff. Un estado numérico no entero, un intento no entero, menor que 1 o
mayor/igual al límite, y cualquier error no recuperable producen una decisión
sin reintento y retraso cero.

En el cliente HTTP `HttpIncidentRepository`, el encabezado `Retry-After` se
interpreta de acuerdo con el estándar HTTP RFC 7231 / RFC 9110: cuando contiene
un número, representa segundos (`delay-seconds`) y se convierte a milisegundos
(`parsedSeconds * 1000`); si contiene una fecha HTTP-Date, se calcula la
diferencia contra el reloj actual.

Los `GET` pueden reintentarse ante errores recuperables. Un `POST` sólo puede
reintentarse si recibe una `idempotencyKey` no vacía; la decisión devuelve
`requiresStableIdempotencyKey: true` cuando falta. La función valida que la clave
exista y no sea vacía, y el cliente `HttpIncidentRepository` conserva
estrictamente la misma clave y el mismo cuerpo JSON en cada reintento, evitando
duplicidad de efectos en el servidor.

## Matriz de decisiones

| Escenario | Acción | Justificación | Resultado esperado |
|---|---|---|---|
| Geocodificación válida con etiqueta y coordenadas dentro de rango | Aceptar ubicación del proveedor y almacenar en caché | El dato cumple el contrato del dominio | Ubicación `provider`, incluidas coordenadas cero |
| Respuesta nula, incompleta, malformada o con coordenadas inválidas | Usar captura manual sin coordenadas | No es seguro inferir una ubicación | Ubicación `manual` sin coordenadas ficticias; no se cachea |
| Geocodificación da timeout o hay desconexión | Permitir captura manual; el adaptador puede reintentar dentro del límite | La ubicación textual permite seguir sin bloquear por el tercero | Referencia manual o contingencia en caché |
| Geocodificación recibe HTTP 429 | Respetar `Retry-After` al reintentar; si no se recupera, usar ubicación manual | Evita ignorar el límite comunicado y ofrece alternativa | Espera indicada o captura manual |
| Error temporal 408, 425, 5xx o timeout en una solicitud GET, antes del intento 4 | Reintentar con `Retry-After` válido o backoff exponencial | Falla potencialmente transitoria y lectura sin efecto de escritura | Reintento finito (máximo 4 intentos totales) |
| POST con error recuperable y clave de idempotencia estable conservada | Reintentar con la misma clave y contenido, antes del intento 4 | La clave permite deduplicar el replay si el servidor soporta idempotencia | Resultado existente o una sola operación aplicada |
| POST sin clave de idempotencia válida | No reintentar; informar el resultado incierto o pedir una acción segura | Repetir puede duplicar la operación | No se envía un segundo POST |
| Error no recuperable, clave ausente para POST, o intento actual 4 | Informar fallo terminal de la solicitud | Reintentar no está permitido por la política | Error visible y sin bucle de solicitudes |
| Fallo terminal sólo del proveedor de geocodificación | Continuar con referencia manual | La falla externa no invalida el resto de la incidencia | Creación disponible con ubicación manual |

## Decisiones técnicas y tradeoffs

- **Fallback manual en vez de coordenadas aproximadas:** conserva la intención
  del reportante y evita datos geográficos falsos. El costo es que la referencia
  puede no ser geocodificable ni servir para navegación automática.
- **Backoff determinista y acotado:** facilita pruebas reproducibles y evita
  ciclos ilimitados. No distribuye la carga como lo haría jitter, lo que queda
  como posible mejora si el servicio real lo requiere. El máximo de intentos y
  la demora base están centralizados en una configuración interna tipada, con
  valores predeterminados que satisfacen el contrato público.
- **Retry-After prevalece:** respeta la indicación del servidor conforme a
  RFC 7231, aunque puede aumentar el tiempo antes de completar la operación.
  La política no lo limita; el adaptador implementa esperas compatibles con
  los temporizadores de su runtime sin acortar la espera solicitada.
- **Clave obligatoria para repetir POST:** reduce duplicados tras respuestas
  perdidas. Requiere que el cliente mantenga la misma clave y contenido;
  `HttpIncidentRepository` asegura la propagación de `Idempotency-Key` en cada
  reintento.
- **Caché en memoria implementada:** reduce el consumo de cuota y la latencia
  en consultas repetidas mediante clave normalizada y TTL de 5 minutos. Solo
  almacena datos exitosos de proveedor; ante fallas de red o 429 permite
  recurrir a un valor previo o activar de inmediato el fallback manual. Al ser
  volátil, no persiste tras cerrar la aplicación.
- **Proveedor de producción pendiente:** elegir uno sin conocer sus cuotas,
  privacidad y disponibilidad sería una decisión no respaldada por la evidencia
  actual; el simulador del curso permite validar todos los casos de resiliencia
  de forma determinista.

## Verificación

La implementación y sus garantías de resiliencia se comprueban con los casos
públicos y las suites de integración del equipo:

```text
npm run typecheck
npm run lint
npm run test:smoke
npm run backend:self-test
npm test -- --ci --runInBand course-tests/public/week-09.test.ts
npm test -- --ci --runInBand course-tests/week-09-resilience-core.test.ts course-tests/resilience/week-09-lost-response.test.ts
make feedback
make verify-week-09
make public-test-week-09
```

Estos comandos se ejecutan sobre Node 22.22.0. La suite de pruebas cubre:
1. `course-tests/public/week-09.test.ts`: Validación de contratos públicos de
   geocodificación y decisiones de `planRetry`.
2. `course-tests/week-09-resilience-core.test.ts`: Validación del adaptador
   `GeocodingService` con caché en memoria y `HttpIncidentRepository` con
   reintentos e idempotencia.
3. `course-tests/resilience/week-09-lost-response.test.ts`: Inyección de
   respuesta perdida con persistencia en servidor, repetición con la misma
   `Idempotency-Key`, garantía de un solo efecto sin duplicados, límite estricto
   de 4 intentos (sin 5to intento), respeto de `Retry-After` RFC 7231, y
   verificación de que ningún error se guarda en la caché.

## Responsabilidades del equipo

- **Integrante 1 (Laloaobes) — contratos y políticas:** tipos de ubicación y
  reintento (`src/domain/location/types.ts`), funciones puras `selectIncidentLocation`
  y `planRetry` en `src/course-evaluation/index.ts`, y diseño de la política base.
- **Integrante 2 (Breyan21) — adaptadores, caché, transporte y UI:** adaptador
  `GeocodingService` con caché en memoria normalizada, cliente `HttpIncidentRepository`
  con soporte de reintentos e `Idempotency-Key`, fallback en UI
  `IncidentListScreen.tsx`, y suite de pruebas `week-09-resilience-core.test.ts`.
- **Integrante 3 (MigueleArt) — calidad, resiliencia y evidencia:** corrección
  de compatibilidad con `exactOptionalPropertyTypes` y estándar RFC 7231 en
  `HttpIncidentRepository`, suite de pruebas `week-09-lost-response.test.ts`
  (respuesta perdida tras guardado, idempotencia, límite de 4 intentos y
  ausencia de duplicados), elaboración de reportes reproducibles
  (`reports/week-09/fault-injection.json`, `reports/week-09/retry-metrics.json`),
  evidencia de decisiones ingenieriles (`evidence/week-09/engineering.json`) y
  verificación integral de quality gates.
