Hallazgo 1 — Falta de protección de datos en la telemetría

- Problema encontrado

La función que se encarga de ocultar datos privados antes de enviarlos a los registros (redactForTelemetry en src/course-evaluation/index.ts) no estaba terminada y se encontraba en estado pending. Esto hacía que los datos enviados a esta función pudieran aparecer directamente en la consola o en los registros.

- Riesgo
Si ocurría un error de conexión o de validación, podían mostrarse datos privados del usuario, como el token de sesión (authorization), la ubicación (latitude, longitude) o información de la incidencia. Si alguien tenía acceso a estos registros, podía obtener información privada o incluso utilizar el token de una sesión.

- Solución
Se completó la función para revisar los datos antes de mostrarlos en los registros.
Ahora el sistema busca datos sensibles como token, password o location. Cuando encuentra alguno, oculta su contenido y lo reemplaza por [REDACTED]. Así, los datos privados ya no se muestran directamente en los registros.

Hallazgo 2 — Configuración CORS demasiado abierta

- Problema encontrado

En el archivo server.mjs del backend se estaba usando access-control-allow-origin:, Esto significa que el servidor permitía recibir solicitudes desde cualquier página web o aplicación.

- Riesgo
Al permitir solicitudes desde cualquier lugar, una página maliciosa podría intentar acceder a información del sistema desde el navegador de un usuario. Esto puede representar un riesgo para la seguridad de las sesiones y de la información de CampusOps.

- Solución
Se quitó el * y se cambió por una variable de entorno llamada ALLOWED_ORIGIN.
Si no se configura esta variable, se utiliza por defecto: http://localhost:8081 , asi el backend solo permite solicitudes desde un origen autorizado y se mejora la seguridad del sistema.

Hallazgo 3 — URL del backend escrita directamente en el código

- Problema encontrado
La dirección del servidor de la API estaba escrita directamente en el código fuente, por ejemplo:http://127.0.0.1:4310 ,Esto hacía que la configuración del servidor estuviera dentro del código y no se manejara de forma externa.

- Riesgo
Si alguien obtiene acceso al código, puede conocer la dirección del backend.Además, si la dirección cambia entre desarrollo, pruebas o producción, es necesario modificar el código manualmente. Esto puede provocar errores de configuración o exponer información del sistema.

- Solución
Se recomienda guardar la URL del backend en una variable de entorno, por ejemplo:process.env.EXPO_PUBLIC_API_URL , De esta manera, la dirección puede cambiar dependiendo del entorno sin modificar el código y se mejora la seguridad y el mantenimiento del proyecto.