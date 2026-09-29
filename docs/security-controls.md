# Controles de seguridad — Semana 4

Controles implementados para las amenazas **TH-03** (secuestro de sesión) y **TH-04** (fuga de información en logs), sobre los activos **AST-01** (sesiones y tokens) y **AST-05** (logs), definidos en `docs/threat-model.md`. Todos los datos de prueba son ficticios.

## Mecanismos de Almacenamiento

- Los tokens de sesión (`accessToken`, `refreshToken`) se guardan solo mediante `src/infrastructure/storage/SecureStorageService.ts`, que usa `expo-secure-store`.
- `expo-secure-store` delega en **Android Keystore** (el valor se cifra con una clave resguardada por el sistema operativo) y en **iOS Keychain**.
- Se usa `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`: el valor solo se lee con el dispositivo desbloqueado y no se migra en respaldos ni a otro equipo.
- La app no usa `AsyncStorage` ni preferencias en texto plano para credenciales. `removeToken` elimina la sesión en reposo al cerrar sesión.
- Ante un fallo del almacén, `saveToken`, `getToken` y `removeToken` no lanzan una excepción: devuelven `false` o `null` y registran solo la operación fallida (`save`, `read` o `remove`), nunca la clave ni el valor.
- No hay secretos escritos en el código ni variables `EXPO_PUBLIC_*` con `SECRET`, `PRIVATE_KEY` o `ACCESS_TOKEN`; las variables `EXPO_PUBLIC_` se incrustan en el bundle y son públicas por diseño. El escaneo lo automatiza `tools/course_public_evaluator.py` (`secret_scan`).

**Alternativas descartadas:** AsyncStorage con cifrado por software (la clave acaba en el bundle y se recupera por ingeniería inversa) y SQLCipher/MMKV cifrado (sobrecarga innecesaria para pocas claves pequeñas).

## Manejo Seguro de Errores

- `src/api/courseBackend.ts` envuelve `fetch` con `try/catch` y un timeout de 5 s (`AbortController`).
- Toda falla (`ECONNREFUSED`, `ETIMEDOUT`/abort, HTTP 5xx, respuesta fuera de contrato) se convierte en `BackendUnavailableError`, cuyo mensaje es siempre **"Error de conexión"**.
- El error original se descarta: no se reenvía como `cause` ni se registra, porque contiene host, puerto, ruta y stack trace.
- `console.error` solo registra contexto técnico seguro: el tipo de falla (`network`, `timeout`, `http`, `contract`) y el código HTTP.
- La interfaz solo muestra el estado `offline`.
- Verificación: `course-tests/security-audit.test.ts` comprueba que ni el mensaje ni los logs contienen `127.0.0.1`, el puerto, `/health`, `ECONNREFUSED`, `ETIMEDOUT` ni líneas de stack.

## Sanitización de registros y telemetría

- `redactForTelemetry` genera una copia recursiva de objetos y arreglos; no muta la entrada recibida por la aplicación.
- Normaliza campos a minúsculas y elimina `_` y `-`; por ello, `accessToken`, `access_token` y `ACCESS-TOKEN` reciben el mismo tratamiento.
- Sustituye por `[REDACTED]` credenciales, identidad, ubicación, fotografías, evidencias, comentarios internos e historial de asignaciones. Conserva contexto técnico como `incidentId`, `correlationId`, `status`, `attempt` y `durationMs`.
- `IncidentListScreen` e `IncidentDetailScreen` no registran objetos `Error`. Emiten eventos de categoría estable mediante `src/telemetry/safeTelemetry.ts`, que sanitiza sus metadatos antes de usar `console.info`.
- `courseBackend` tampoco registra respuestas ni errores originales: solo conserva tipo de falla y, cuando existe, código HTTP. Así no filtra URL, puerto, ruta o stack trace.
- Verificación: `npm test -- --ci --runInBand course-tests/public/week-04.test.ts` comprueba datos anidados sensibles y `npm run typecheck` valida la integración tipada.

## Riesgo Residual

- **Dispositivos rooteados o con jailbreak:** un atacante con privilegios de root puede consultar el Keystore o Keychain desde el propio proceso de la app mientras el dispositivo está desbloqueado. `expo-secure-store` protege los datos en reposo, pero no ante un sistema operativo comprometido.
- **Volcados e instrumentación de memoria (p. ej. Frida):** mientras la app está en uso, el token descifrado vive en memoria y puede interceptarse enganchando `getItemAsync` o `fetch`.
- **Mitigaciones pendientes:** tokens de vida corta con rotación (semana 6), revocación en servidor y, si el riesgo lo justifica, detección de root o jailbreak. Estas medidas se aceptan como riesgo residual en esta entrega.
- **Límite operativo:** SecureStore puede rechazar valores mayores a ~2 KB, así que no se usa para datos grandes.
