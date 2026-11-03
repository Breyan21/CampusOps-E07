# Política de resiliencia de CampusOps

## Objetivo y alcance

Esta política establece cómo representar una ubicación cuando la geocodificación
no produce datos utilizables y cómo decidir reintentos HTTP acotados. El objetivo
es permitir que una incidencia conserve una referencia escrita por el usuario
sin depender de que un servicio externo esté disponible, y evitar reintentos que
generen esperas inválidas o dupliquen operaciones de escritura.

Los contratos de dominio y las funciones puras se implementan en
`src/domain/location/types.ts` y `src/course-evaluation/index.ts`. La solicitud
de red, la caché y la interfaz corresponden al adaptador y la UI del integrante 2.

## Proveedor externo y límites

El proyecto todavía no identifica un proveedor externo real de mapas o
geocodificación. La selección del servicio, sus cuotas, términos de uso,
retención de consultas y configuración de credenciales quedan pendientes de
confirmación del equipo; esta política no atribuye una cuota ni una integración
real a ningún proveedor.

El backend del curso ofrece `GET /v1/geocoding?q=...` como doble determinista
para pruebas. Devuelve ubicaciones sintéticas y escenarios controlados, incluidos
429 con `Retry-After`, datos incompletos y coordenadas inválidas. No consulta
lugares reales, no sustituye al proveedor de producción y no debe exponerse a
Internet. Toda integración real dependerá de conectividad y deberá evitar enviar
datos personales en las consultas; sólo se usarán referencias sintéticas durante
las pruebas del curso.

Hasta que se elija un proveedor, no se puede afirmar qué cuota, precisión,
disponibilidad o política de privacidad aplicará. El equipo debe documentar esos
límites antes de habilitar una integración real.

## Estrategia de caché

La aplicación todavía no contiene un servicio de geocodificación ni una caché
implementada. La caché en memoria es responsabilidad del integrante 2; por
tanto, no se afirma que las solicitudes actuales se almacenen, expiren o
invaliden de una forma concreta.

Como decisión pendiente de implementación, la caché debería usar una clave
normalizada del texto de búsqueda, reutilizar resultados válidos para reducir
consultas redundantes y definir explícitamente un TTL y una regla de invalidación.
Un resultado de error o una respuesta 429 no debe guardarse como si fuera una
ubicación válida. Si hay un resultado válido vigente cuando ocurre un 429, el
adaptador podrá usarlo conforme a la política de caché que el equipo implemente;
sin resultado válido, debe presentar la captura manual. Al ser volátil, una
caché en memoria se pierde al cerrar la aplicación y no coordina consultas entre
dispositivos.

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
Un timeout, una desconexión o un estado HTTP 429 se deben traducir en el
adaptador a un resultado no disponible; entonces la interfaz permite escribir
un edificio, zona o referencia. La selección manual permite continuar con la
creación de la incidencia cuando el resto de sus datos sea válido.

## Política de reintentos

`planRetry` es determinista. Considera recuperables el timeout y los estados
HTTP enteros 408, 425, 429 y 500–599. Los demás estados son terminales para esta
política. La configuración interna tipada `RETRY_POLICY` centraliza
`maxAttempts: 4` y `baseDelayMs: 500`; se puede ajustar en el módulo sin cambiar
la firma pública de `planRetry`. Sólo programa un reintento si el intento actual
es un entero entre 1 y 3; desde el intento 4 no programa otro. Por tanto,
contando la solicitud inicial, puede haber como máximo cuatro intentos. Esta
configuración es de código, no una opción de runtime ni una preferencia del
usuario.

Para errores recuperables sin un `Retry-After` válido, el retraso es un backoff
exponencial de 500 ms multiplicado por `2^(attempt - 1)`. La función no añade
jitter, por lo que su resultado es reproducible. Un `retryAfterMs` numérico,
finito y no negativo prevalece sobre el backoff y se conserva exactamente,
incluidos valores fraccionarios o muy grandes. Valores ausentes, negativos,
`NaN` o infinitos no se consideran válidos y se usa el backoff. Un estado
numérico no entero, un intento no entero, menor que 1 o mayor/igual al límite,
y cualquier error no recuperable producen una decisión sin reintento y retraso
cero.

La función decide y devuelve `delayMs`; no programa temporizadores. Un retraso
finito muy grande sigue siendo válido y no se recorta aquí para no ignorar
`Retry-After`. El adaptador debe comprobar los límites de temporizador de su
runtime y, si un único temporizador no puede representar el retraso, esperar en
intervalos finitos encadenados hasta completar el tiempo indicado, sin iniciar
el reintento antes de tiempo. Los retrasos fraccionarios se devuelven tal cual;
el adaptador debe considerar cómo los representa su runtime de temporizadores.

Los `GET` pueden reintentarse ante errores recuperables. Un `POST` sólo puede
reintentarse si recibe una `idempotencyKey` no vacía; la decisión devuelve
`requiresStableIdempotencyKey: true` cuando falta. La función valida que la clave
exista y no sea vacía, pero no puede comprobar por sí sola que el llamador use
la misma clave y el mismo contenido en cada intento. El adaptador debe conservar
ambos. Sin esa garantía, no debe repetirse una escritura cuyo resultado sea
incierto.

## Matriz de decisiones

| Escenario | Acción | Justificación | Resultado esperado |
|---|---|---|---|
| Geocodificación válida con etiqueta y coordenadas dentro de rango | Aceptar ubicación del proveedor | El dato cumple el contrato del dominio | Ubicación `provider`, incluidas coordenadas cero |
| Respuesta nula, incompleta, malformada o con coordenadas inválidas | Usar captura manual | No es seguro inferir una ubicación | Ubicación `manual` sin coordenadas ficticias |
| Geocodificación da timeout o hay desconexión | Permitir captura manual; el adaptador puede reintentar dentro del límite | La ubicación textual permite seguir sin bloquear por el tercero | Referencia manual o resultado del reintento |
| Geocodificación recibe HTTP 429 | Respetar `Retry-After` al reintentar; si no se recupera, usar ubicación manual | Evita ignorar el límite comunicado y ofrece alternativa | Espera indicada o captura manual |
| Error temporal 408, 425, 5xx o timeout en una solicitud GET, antes del intento 4 | Reintentar con `Retry-After` válido o backoff exponencial | Falla potencialmente transitoria y lectura sin efecto de escritura | Reintento finito |
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
- **Retry-After prevalece:** respeta la indicación del servidor, aunque puede
  aumentar el tiempo antes de completar la operación. La política no lo limita;
  el adaptador debe implementar esperas compatibles con los temporizadores de
  su runtime sin acortar la espera solicitada.
- **Clave obligatoria para repetir POST:** reduce duplicados tras respuestas
  perdidas. Requiere que el cliente mantenga la misma clave y contenido; la
  función de política no puede probar esa estabilidad.
- **Caché en memoria prevista, aún no implementada:** puede reducir cuota y
  latencia, pero pierde su contenido al cerrar la app y no evita duplicados
  entre dispositivos. TTL, normalización e invalidación deben concretarse en la
  implementación del integrante 2.
- **Proveedor pendiente:** elegir uno sin conocer sus cuotas, privacidad y
  disponibilidad sería una decisión no respaldada por la evidencia actual.
- **Configuración de runtime pendiente de acuerdo:** la función conserva su
  firma pública y usa valores internos. Si el equipo necesita cambiar el límite
  o el backoff en runtime, el integrante 1 y el integrante 2 deben acordar una
  interfaz de configuración tipada y su origen antes de ampliar el contrato; no
  se agrega una opción implícita al objeto de entrada actual.

## Verificación

La implementación se comprueba con los casos públicos de la Semana 09 y con los
checks de TypeScript y ESLint:

```text
npx jest course-tests/public/week-09.test.ts
npm run typecheck
npm run lint
```

Estos comandos deben ejecutarse en el entorno de entrega y sus resultados deben
registrarse tal como se observaron. La prueba pública cubre ubicación válida y
fallback, el respeto a `Retry-After`, el límite de intentos y el bloqueo de POST
sin clave. No demuestra una integración con un proveedor externo, una caché, ni
la repetición real de solicitudes HTTP con identidad estable; esos puntos
requieren pruebas de integración del equipo.

## Responsabilidades del equipo

- **Integrante 1 — contratos y políticas:** tipos de ubicación/reintento,
  `selectIncidentLocation`, `planRetry` y este documento.
- **Integrante 2 — adaptadores, caché, transporte y UI:** solicitudes de
  geocodificación, caché, traducción de fallas HTTP, espera asíncrona, propagación
  de `Idempotency-Key` y captura manual en la interfaz.
- **Integrante 3 — calidad y evidencia:** inyección de fallas, escenarios de
  respuesta perdida/429, métricas y reportes reproducibles conforme al contrato
  de evidencia.
