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

El adaptador admite dos proveedores: `nominatim` (predeterminado para la
ejecución externa del hito) y `course` (doble determinista para pruebas). Se
elige el inicial con `EXPO_PUBLIC_GEOCODING_PROVIDER` y la app permite cambiar
entre los dos en runtime desde el formulario, sin recompilar. Al cambiar se
vacía la caché para no mezclar resultados. La URL de Nominatim se puede cambiar
con `EXPO_PUBLIC_NOMINATIM_URL`; el doble usa
`EXPO_PUBLIC_COURSE_BACKEND_URL`.

La integración externa usa la búsqueda de Nominatim en OpenStreetMap con
`format=jsonv2`, `limit=1` e idioma español. La búsqueda sólo ocurre cuando el
usuario pulsa **Buscar coordenadas**; no hay autocompletado ni consultas en cada
tecla. El cliente se identifica como `CampusOps-E07/1.0 (academic project)` y
muestra la atribución `© OpenStreetMap contributors`. El código limita las
solicitudes a una por segundo, cachea consultas y deja el endpoint configurable
para poder cambiarlo. La política del servidor público limita el uso a una
solicitud por segundo, requiere User-Agent/Referer identificable, atribución,
prohíbe enviar datos personales o confidenciales y desaconseja usos intensivos.
No debe tratarse como SLA de producción; si las necesidades exceden este uso
académico, se debe cambiar a un servicio contratado o administrado por el equipo.
Fuentes oficiales: [política de uso de Nominatim](https://operations.osmfoundation.org/policies/nominatim/)
y [API de búsqueda](https://nominatim.org/release-docs/latest/api/Search/).

### Evidencia de ejecución externa

El 2026-11-03T03:44:15Z se ejecutó `GeocodingService` contra Nominatim con
`provider: nominatim`, User-Agent identificable y la búsqueda ficticia
`CampusOps edificio ficticio de prueba Ciudad de México`. El proveedor respondió
HTTP 200 sin coincidencias (`[]`); el servicio devolvió la referencia con
`source: manual` y `cacheSize: 0`. El 2026-11-03T03:46:45Z se ejecutó de nuevo
el adaptador con el fixture público `Palacio de Bellas Artes, Ciudad de México`:
devolvió `source: provider`, etiqueta de Nominatim y coordenadas
`19.4355009, -99.1412585`, con `cacheSize: 1`. El segundo fixture es un lugar
público, no una ubicación de incidencia ni dato personal. Estas dos llamadas
documentan los caminos de fallback y coincidencia del adaptador real; las
pruebas reproducibles de fallos siguen usando el doble del curso. Las métricas
y pruebas históricas de `week-09-final` pertenecen al SHA que indican; el código
modificado en esta rama debe volver a verificarse antes de crear una nueva
etiqueta de entrega.

El backend del curso ofrece `GET /v1/geocoding?q=...` como doble determinista
para pruebas y evaluación académica. Devuelve ubicaciones sintéticas y escenarios
controlados, incluidos 429 con `Retry-After`, datos incompletos y coordenadas
inválidas. No consulta lugares reales y no debe exponerse a Internet. Las
ejecuciones contra el doble no se presentan como evidencia de ejecución externa.
En ambos proveedores se envían sólo consultas que el usuario inicia y no se
incluyen nombres, fotos, comentarios ni datos de una incidencia en telemetría.
El timeout por solicitud es 3000 ms por defecto; los errores terminan en caché
válida o captura manual sin coordenadas inventadas.

Si Nominatim devuelve una coincidencia, la UI conserva la referencia escrita y
añade la etiqueta y latitud/longitud a la cadena `location` que acepta el
contrato actual de creación de incidencias. Si no hay resultado o el proveedor
falla, se envía sólo la ubicación manual introducida.

## Estrategia de caché

El adaptador `GeocodingService` implementa una caché en memoria indexada por
consulta normalizada (`query.trim().replace(/\s+/g, ' ').toLowerCase()`). Sus propiedades y reglas
operativas son:

- **Clave normalizada:** Convierte el texto de búsqueda a minúsculas y colapsa
  espacios en blanco internos superfluos para maximizar los aciertos en caché ante ligeras
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

En los adaptadores HTTP, el encabezado `Retry-After` se
interpreta de acuerdo con el estándar HTTP RFC 7231 / RFC 9110: cuando contiene
un entero, representa segundos (`delay-seconds`) y se convierte a milisegundos;
si contiene una fecha HTTP-Date, se calcula la diferencia contra el reloj actual.
Una respuesta 429 transitoria se reintenta cuando la política lo permite y se
respeta el tiempo indicado; si se agotan los intentos, se usa caché válida o
captura manual.

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
  La política no lo acorta; el adaptador Nominatim también impone un mínimo de
  un segundo entre solicitudes.
- **Clave obligatoria para repetir POST:** reduce duplicados tras respuestas
  perdidas. Requiere que el cliente mantenga la misma clave y contenido;
  `HttpIncidentRepository` asegura la propagación de `Idempotency-Key` en cada
  reintento.
- **Caché en memoria implementada:** reduce el consumo de cuota y la latencia
  en consultas repetidas mediante clave normalizada y TTL de 5 minutos. Solo
  almacena datos exitosos de proveedor; ante fallas de red o 429 permite
  recurrir a un valor previo o activar de inmediato el fallback manual. Al ser
  volátil, no persiste tras cerrar la aplicación.
- **Proveedor público reemplazable:** Nominatim permite demostrar una ejecución
  real con una consulta iniciada por el usuario y datos no personales. Su baja
  capacidad y política de uso hacen que sea adecuado sólo para esta demostración
  académica; el doble del curso sigue siendo la opción reproducible para pruebas.

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
