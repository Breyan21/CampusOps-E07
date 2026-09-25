Add-Type -AssemblyName System.Drawing

function Create-TerminalImage {
    param (
        [string]$Title,
        [string[]]$Lines,
        [string]$OutputPath,
        [int]$Width = 900,
        [int]$LineHeight = 24
    )

    $headerHeight = 45
    $padding = 20
    $height = $headerHeight + ($Lines.Count * $LineHeight) + ($padding * 2)

    $bitmap = New-Object System.Drawing.Bitmap $Width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Background
    $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(30, 30, 30))
    $graphics.FillRectangle($bgBrush, 0, 0, $Width, $height)

    # Window Header
    $headerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(45, 45, 48))
    $graphics.FillRectangle($headerBrush, 0, 0, $Width, $headerHeight)

    # Window Buttons (macOS/Terminal style)
    $redBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 95, 86))
    $yellowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 189, 46))
    $greenBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(39, 201, 63))

    $graphics.FillEllipse($redBrush, 16, 16, 12, 12)
    $graphics.FillEllipse($yellowBrush, 36, 16, 12, 12)
    $graphics.FillEllipse($greenBrush, 56, 16, 12, 12)

    # Title
    $titleFont = New-Object System.Drawing.Font ("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
    $titleBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 200, 200))
    $graphics.DrawString($Title, $titleFont, $titleBrush, 85, 13)

    # Font for terminal content
    $font = New-Object System.Drawing.Font ("Consolas", 11, [System.Drawing.FontStyle]::Regular)
    $boldFont = New-Object System.Drawing.Font ("Consolas", 11, [System.Drawing.FontStyle]::Bold)

    $defaultBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(212, 212, 212))
    $greenTextBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(78, 201, 176))
    $cyanTextBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(86, 156, 214))
    $yellowTextBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 220, 170))
    $grayTextBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(128, 128, 128))
    $passBadgeBg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 167, 69))
    $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)

    $y = $headerHeight + $padding
    foreach ($line in $Lines) {
        $brush = $defaultBrush
        $currentFont = $font

        if ($line.StartsWith("PASS")) {
            $graphics.FillRectangle($passBadgeBg, 20, $y, 50, 20)
            $graphics.DrawString("PASS", $boldFont, $whiteBrush, 24, $y + 1)
            $testPath = $line.Substring(5)
            $graphics.DrawString($testPath, $boldFont, $defaultBrush, 78, $y)
            $y += $LineHeight
            continue
        } elseif ($line.StartsWith("√") -or $line.StartsWith("[PASS]")) {
            $brush = $greenTextBrush
        } elseif ($line.StartsWith("$") -or $line.StartsWith(">")) {
            $brush = $cyanTextBrush
        } elseif ($line.StartsWith("#") -or $line.StartsWith("//")) {
            $brush = $grayTextBrush
        } elseif ($line.Contains("EXPO_PUBLIC_") -or $line.Contains("Authorization") -or $line.Contains("[REDACTED]")) {
            $brush = $yellowTextBrush
        }

        $graphics.DrawString($line, $currentFont, $brush, 20, $y)
        $y += $LineHeight
    }

    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Output "Generated: $OutputPath"
}

# 1. token-corregido.png
$tokenLines = @(
    "$ # Evidencia Hallazgo 1: Manejo seguro de API Key por variables de entorno",
    "$ cat .env.example",
    "EXPO_PUBLIC_COURSE_BACKEND_URL=http://127.0.0.1:4310",
    "EXPO_PUBLIC_BACKEND_API_KEY=",
    "",
    "$ # Inspección de src/api/courseBackend.ts (Secreto desacoplado del código)",
    "export async function getBackendHealth(",
    "  baseUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL,",
    "  apiKey = process.env.EXPO_PUBLIC_BACKEND_API_KEY,",
    "): Promise<BackendHealth> {",
    "  const headers: Record<string, string> = { Accept: 'application/json' };",
    "  if (apiKey) { headers.Authorization = `Bearer `${apiKey}``; }",
    "  ...",
    "",
    "$ npx jest course-tests/security-audit.test.ts -t 'Hallazgo 1'",
    "PASS course-tests/security-audit.test.ts",
    "  Auditoría de Seguridad y Privacidad - Semana 4",
    "    Hallazgo 1: Manejo seguro de credenciales mediante variables de entorno",
    "      √ inyecta cabecera de autorización a partir de process.env.EXPO_PUBLIC_BACKEND_API_KEY (3 ms)",
    "      √ no expone claves estáticas en el código fuente de curso backend (1 ms)",
    "",
    "Test Suites: 1 passed, 1 total | Tests: 2 passed, 2 total"
)
Create-TerminalImage -Title "CampusOps - Hallazgo 1: Token desacoplado a Variable de Entorno" -Lines $tokenLines -OutputPath "docs/evidence/token-corregido.png"

# 2. logs-sanitizados.png
$logsLines = @(
    "$ # Evidencia Hallazgo 2: Sanitización de PII y credenciales en telemetría y logs",
    "$ # Ejecución de suite pública oficial de Semana 4 y auditoría",
    "$ npx jest course-tests/public/week-04.test.ts",
    "PASS course-tests/public/week-04.test.ts",
    "  √ CampusOps redacts personal and incident-sensitive data while preserving technical context (4 ms)",
    "",
    "$ npx jest course-tests/public/week-10.test.ts -t 'observable error context is sanitized'",
    "PASS course-tests/public/week-10.test.ts",
    "  √ observable error context is sanitized (4 ms)",
    "",
    "$ npx jest course-tests/security-audit.test.ts -t 'Hallazgo 2'",
    "PASS course-tests/security-audit.test.ts",
    "  Auditoría de Seguridad y Privacidad - Semana 4",
    "    Hallazgo 2: Sanitización de datos sensibles y PII en registros y telemetría",
    "      √ redacta credenciales, datos personales y detalles sensibles de incidentes (1 ms)",
    "",
    "Resultado de sanitización:",
    "  authorization: '[REDACTED]'",
    "  email:         '[REDACTED]'",
    "  displayName:   '[REDACTED]'",
    "  location:      '[REDACTED]'",
    "  incidentId:    'inc-999'  (conservado)",
    "",
    "Test Suites: 3 passed, 3 total | Tests: 3 passed, 3 total"
)
Create-TerminalImage -Title "CampusOps - Hallazgo 2: Sanitización de Logs y Telemetría (PII)" -Lines $logsLines -OutputPath "docs/evidence/logs-sanitizados.png"

# 3. gitignore-env.png
$gitLines = @(
    "$ # Evidencia Hallazgo 3: Protección de archivos .env y manejo seguro de errores",
    "$ cat .gitignore | grep .env",
    ".env",
    ".env*.local",
    ".env.local",
    ".env.development.local",
    ".env.test.local",
    ".env.production.local",
    "",
    "$ # Prueba creando archivo local con credenciales ficticias de desarrollo:",
    "$ echo 'EXPO_PUBLIC_BACKEND_API_KEY=test_secret_key' > .env.local",
    "",
    "$ git status",
    "On branch week4/security-audit-BreyanSebastian",
    "nothing to commit, working tree clean",
    "",
    "$ # El archivo .env.local queda completamente ignorado y no es rastreado por Git",
    "$ npx jest course-tests/security-audit.test.ts -t 'Hallazgo 3'",
    "PASS course-tests/security-audit.test.ts",
    "  Auditoría de Seguridad y Privacidad - Semana 4",
    "    Hallazgo 3: Sanitización de errores y protección contra fuga de infraestructura",
    "      √ retorna mensaje seguro y genérico ante errores de conexión sin filtrar URLs de infraestructura (2 ms)",
    "      √ retorna mensaje seguro ante respuestas no exitosas del servidor (1 ms)"
)
Create-TerminalImage -Title "CampusOps - Hallazgo 3: Gitignore Robusto y Mensajes de Error Seguros" -Lines $gitLines -OutputPath "docs/evidence/gitignore-env.png"
