# Prueba técnica QA Engineer — NerdsAi

Este repositorio contiene mi solución a los cinco ejercicios de la prueba técnica: evaluación conversacional de LLM, pruebas de API, automatización de chatbot web, CI/CD y reporte consolidado.

Aquí encontrarás cómo preparar tu equipo, elegir un proveedor y ejecutar cada ejercicio. También puedes revisar los resultados guardados en [`output/`](output/) y las ejecuciones de [GitHub Actions](https://github.com/marioRodriguez6/QA-engineer-technical-test/actions).

## 1. Prepara tu entorno

Necesitas Node.js 22, npm y acceso a Internet. Para el Ejercicio 1 también necesitas una clave y cuota del proveedor LLM que elijas, o un servidor Ollama con sus modelos instalados.

Los comandos están escritos para Bash en Linux o Ubuntu WSL. Ejecútalos desde la raíz del repositorio:

```bash
git clone https://github.com/marioRodriguez6/QA-engineer-technical-test.git
cd QA-engineer-technical-test
npm ci
npx playwright install --with-deps chromium
```

El último comando instala Chromium y sus dependencias para las pruebas del chatbot. Puedes comprobar que TypeScript compila antes de continuar:

```bash
npx tsc --noEmit
```

Las pruebas de API y chatbot consultan servicios reales y no requieren claves de proveedores LLM.

## 2. Configura el proveedor del Ejercicio 1

Puedes usar **OpenAI, Anthropic, Groq, Gemini u Ollama**. El ejercicio tiene tres roles, y cada uno puede utilizar un proveedor y modelo diferentes:

| Rol | Qué hace |
| --- | --- |
| `SIMULATED_USER` | Genera los mensajes del usuario según el escenario y el historial. |
| `ASSISTANT` | Responde con la base de conocimiento de Nerds Store. |
| `EVALUATOR` | Evalúa las respuestas usando el historial acumulado y la base de conocimiento. |

Copia la plantilla de configuración:

```bash
cp .env.example .env
```

Si ya tienes `.env`, edítalo directamente para conservar tus valores. La plantilla incluye Groq como ejemplo; puedes reemplazarlo.

Por cada rol debes definir su proveedor y modelo. Este es un ejemplo con Anthropic, usando el modelo configurado también en el workflow:

```dotenv
SIMULATED_USER_PROVIDER=anthropic
SIMULATED_USER_MODEL=claude-haiku-5-5
ASSISTANT_PROVIDER=anthropic
ASSISTANT_MODEL=claude-haiku-5-5
EVALUATOR_PROVIDER=anthropic
EVALUATOR_MODEL=claude-haiku-5-5
ANTHROPIC_API_KEY=your_private_key
```

Sustituye los valores por los del proveedor y modelo que quieras evaluar. El modelo debe estar disponible en tu cuenta y ser compatible con el adaptador. El asistente utiliza tool calling, por lo que su modelo debe admitirlo.

| Proveedor | Valor de `*_PROVIDER` | Credencial o configuración |
| --- | --- | --- |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| Groq | `groq` | `GROQ_API_KEY` |
| Gemini | `gemini` | `GEMINI_API_KEY` |
| Ollama | `ollama` | `OLLAMA_BASE_URL`; predeterminado: `http://localhost:11434/api` |

Para combinar proveedores, cambia el par de variables del rol correspondiente y agrega su clave. Por ejemplo, puedes conservar usuario/asistente en Anthropic y usar `EVALUATOR_PROVIDER=groq`, `EVALUATOR_MODEL=openai/gpt-oss-20b` y `GROQ_API_KEY` para el juez.

Solo se utilizan las claves de los proveedores seleccionados. Los roles que comparten proveedor también comparten su cuota; no se cambia automáticamente a otro si se agota. Un proveedor fuera de los cinco admitidos necesita su propio adaptador.

Para ejecutar en tu ordenador basta con `.env`; no necesitas configurar secrets en GitHub. No publiques ese archivo ni claves reales.

## 3. Ejecuta los ejercicios

### Ejercicio 1 — Evaluación conversacional

Para ejecutar los cinco escenarios:

```bash
node exercise-4-cicd/run-llm-ci.mjs
```

Este comando hace llamadas a los proveedores configurados y consume su cuota. Ejecuta los escenarios uno detrás de otro:

| Escenario | Identificador |
| --- | --- |
| Consulta simple | `simple-query` |
| Cambio de tema | `topic-change` |
| Información ambigua | `ambiguous-information` |
| Memoria conversacional | `conversational-memory` |
| Seguridad y prompt injection | `prompt-injection` |

Cada escenario tiene seis intercambios de usuario/asistente. Algunos mensajes son fijos para asegurar que se prueben las situaciones previstas; los demás se generan según el historial. Después de cada respuesta, el juez registra sus métricas y hallazgos. La evaluación final se obtiene automáticamente de esos juicios.

También puedes ejecutar un escenario individual. Sustituye el identificador del ejemplo por el que quieras revisar:

```bash
npx tsx exercise-1-llm-evaluation/runner.ts conversational-memory
```

Encontrarás los resultados en:

- `output/exercise1-JSON/<scenario-id>.json`: conversación, métricas, errores y veredicto del escenario.
- `output/exercise1-JSON/ci/`: al ejecutar los cinco escenarios, guarda sus JSON, logs y `execution-summary.json`.

Los reportes de una ejecución anterior se reemplazan para evitar aceptar resultados antiguos como actuales.

![Ejemplo de ejecución del Ejercicio 1](media/EXERCISE1_LLM.jpeg)

### Ejercicio 2 — Pruebas de API

Ejecuta la suite completa contra [Goal Tracker API](https://goal-tracker-api.onrender.com):

```bash
npm run test:api
```

Las once pruebas cubren estado del servicio, registro, login válido e inválido, creación de dos objetivos, consultas, integridad de datos, listado y eliminación con comprobación posterior.

La suite crea un usuario y objetivos nuevos. Sus casos comparten autenticación e identificadores, así que conviene ejecutarla completa.

Para abrir el reporte:

```bash
npm run test:api:report
```

Los resultados están en `output/exercise2API-Reports/`: `results.json`, `html/` y `test-results/`.

Si quieres usar otra instancia compatible de la API:

```bash
GOAL_TRACKER_API_URL=https://your-api.example.com npm run test:api
```

![Ejemplo de ejecución del Ejercicio 2](media/EXERCISE2_API-REST-TEST.jpeg)

### Ejercicio 3 — Chatbot web

Ejecuta las dos suites:

```bash
npm run test:chatbot:docs
npm run test:chatbot:homepage
```

Para observar el navegador durante una prueba:

```bash
npm run test:chatbot:homepage -- --headed
```

| Suite | Sitio | Resultados |
| --- | --- | --- |
| Docs | https://botpress.com/docs/ | `output/exercise3-chatbot/docs/` |
| Homepage | https://botpress.com/ | `output/exercise3-chatbot/homepage/` |

Las pruebas comprueban carga, widget, apertura/cierre, envío de Hola, respuesta y tiempo hasta el primer texto visible. La homepage también comprueba la reapertura y el nombre del bot. Cada prueba usa un contexto de navegador aislado.

Puedes abrir los reportes con:

```bash
npx playwright show-report output/exercise3-chatbot/docs/html
npx playwright show-report output/exercise3-chatbot/homepage/html
```

Se conservan capturas, videos, trazas y JSON de latencia. Docs escribe `chatbot-response-time.json`; homepage adjunta `homepage-response-time.json` dentro de HOME-004. La medición empieza al enviar Hola y distingue la respuesta nueva del mensaje de bienvenida; incluye la sobrecarga de UI y aserciones.

**Limitación documentada:** `CHATBOT-003` está omitido porque Docs no muestra un nombre distintivo del bot. La comprobación del nombre en la homepage es cobertura adicional. Los localizadores corresponden a la estructura observada: panel integrado en Docs y Shadow DOM en la homepage.

Para reunir ambas suites en un reporte local o elegir otra carpeta de salida, usa `QA_REPORT_DIR`:

```bash
QA_REPORT_DIR=output/exercise3-chatbot/combined npx playwright test exercise-3-chatbot-testing/tests/
```

![Ejemplo de ejecución del Ejercicio 3](media/EXERCISE3_CHATBOT.jpeg)

### Ejecutar API y ambos chatbots juntos

```bash
npm test
```

Este comando ejecuta las tres suites, continúa con las demás si una falla y conserva sus reportes por separado. Guarda un resumen en `output/ci/playwright-execution.json`. El Ejercicio 1 se ejecuta con su comando propio.

### Ejercicio 4 — CI/CD con GitHub Actions

El workflow permite ejecutar las pruebas en un ordenador proporcionado por GitHub. Descarga el repositorio, prepara el entorno y ejecuta los comandos definidos en [`.github/workflows/qa.yml`](.github/workflows/qa.yml).

Puedes evaluar todo localmente siguiendo los ejercicios anteriores. Para ejecutar el pipeline en tu propia copia de GitHub, sigue estos pasos.

#### Cuándo se ejecuta

| Evento | Qué lo inicia |
| --- | --- |
| `push` | Subir un commit al repositorio, incluido el generado al hacer merge. |
| `pull_request` | Abrir o actualizar una solicitud de cambios. |
| `workflow_dispatch` | Iniciarlo manualmente desde Actions. |

Los commits con `[skip ci]` omiten las ejecuciones automáticas de push/pull request. El proyecto usa esa marca cuando publica reportes generados.

#### Qué hace el pipeline

1. **Prepara y valida el proyecto:** instala dependencias, comprueba TypeScript y ejecuta las pruebas locales del evaluador, las métricas y el generador de reportes.
2. **Ejecuta los ejercicios:** si la validación termina correctamente, inicia cuatro jobs independientes: API, chatbot de Docs, chatbot de la homepage y los cinco escenarios LLM. Dentro del job LLM, los escenarios se ejecutan secuencialmente.
3. **Genera el consolidado:** al terminar los jobs anteriores, reúne sus evidencias y genera el reporte del Ejercicio 5. Este paso se intenta incluso si alguna prueba anterior falla, para documentar lo ocurrido.

En Actions aparecen seis jobs: validación, API, Docs, homepage, LLM y consolidado. Al iniciarlo manualmente se ejecuta todo ese recorrido.

#### Cómo ejecutarlo en tu copia del repositorio

1. Crea un fork o una copia del repositorio en tu cuenta.
2. Abre **Settings → Secrets and variables → Actions → New repository secret**.
3. Agrega `GROQ_API_KEY` si usarás Groq, o `ANTHROPIC_API_KEY` si usarás Anthropic, con el valor de tu clave.
4. Abre **Actions → QA Technical Assessment → Run workflow**.
5. Selecciona la rama y el valor de `llm_provider`, y pulsa **Run workflow**.

Si GitHub muestra un aviso para habilitar Actions en tu fork, habilítalo antes de iniciar la ejecución.

El selector actual ofrece **Groq y Anthropic** y aplica la selección al usuario simulado, asistente y juez. Groq usa `qwen/qwen3.8-27b` para usuario/asistente y `openai/gpt-oss-20b` para juez; Anthropic usa `claude-haiku-5-5` en los tres. Revisa su disponibilidad y cuota en tu cuenta. Los eventos automáticos de push/pull request usan Groq por defecto.

**Actions no utiliza el `.env` de tu ordenador.** Sus credenciales proceden de los secrets del repositorio. Los forks no heredan los secrets del original; los pull requests procedentes de forks omiten el job LLM.

Para usar OpenAI, Gemini, Ollama o combinar proveedores en CI:

- Configura los seis valores de proveedor/modelo en `jobs.llm.env`.
- Pasa las claves necesarias a los pasos `Validate selected provider secret` y `Run all five LLM scenarios`, usando los nombres de la tabla de proveedores.
- Adapta la validación de claves para revisar todos los proveedores seleccionados; actualmente presupone el mismo proveedor en los tres roles.
- Si amplías el selector, actualiza también las expresiones que eligen los modelos. Para Ollama, usa un servidor alcanzable desde GitHub o un runner propio; el `localhost` del runner es distinto del de tu equipo.

Crear un secret por sí solo no selecciona el proveedor. Las llamadas LLM del pipeline consumen la cuota de la cuenta configurada.

#### Dónde encontrar los resultados

Abre la ejecución en **Actions**. Dentro de cada job encontrarás sus pasos y logs; en **Artifacts** puedes descargar los reportes y evidencias disponibles, conservados durante 30 días:

```text
qa-api-<run-id>-<attempt>
qa-chatbot-docs-<run-id>-<attempt>
qa-chatbot-homepage-<run-id>-<attempt>
qa-llm-<run-id>-<attempt>
qa-consolidated-report-<run-id>-<attempt>
```

El job final también publica los resultados en `/output` de la rama ejecutada cuando tiene permisos. Los PR de forks conservan solo artefactos.

Un hallazgo funcional del LLM se guarda como resultado de la evaluación. Cuota agotada, timeout, respuestas ausentes o fallas de TypeScript/API/UI se muestran como problemas de ejecución. Más abajo se explica cómo leer esos estados.

### Ejercicio 5 — Reporte consolidado

El pipeline genera automáticamente un reporte en **JSON y Markdown** con los cinco escenarios LLM, API, ambos chatbots, cobertura y hallazgos de los detectores, porcentajes globales PASS/FAIL, completitud y tiempos. Cada caso API/UI muestra su descripción junto al identificador. Las conversaciones y justificaciones extensas están en secciones desplegables.

Los reportes publicados están en:

| Carpeta | Contenido |
| --- | --- |
| `output/reporte-consolidado/lastRun/` | Último intento publicado, incluso con errores técnicos. |
| `output/reporte-consolidado/LastSuccesfulrun/` | Última evaluación completa: cinco escenarios con seis respuestas y seis juicios válidos cada uno, TypeScript y API/UI correctos; puede contener FAIL o REVIEW funcionales. |

Se conserva intencionalmente la escritura `LastSuccesfulrun`. Cada carpeta incluye metadatos en `publication.json` y los controles de reglas en `detector-validation.json`. Las omisiones explícitas, como el nombre del bot de Docs, siguen visibles.

Para generar el consolidado de **tu ejecución local**, ejecuta primero los cinco escenarios LLM y `npm test`. Después reúne sus resultados:

```bash
report_inputs=$(mktemp -d)

cp -R output/exercise1-JSON/ci "$report_inputs/llm"
cp -R output/exercise2API-Reports "$report_inputs/api"
cp -R output/exercise3-chatbot/docs "$report_inputs/chatbot-docs"
cp -R output/exercise3-chatbot/homepage "$report_inputs/chatbot-homepage"

node exercise-5-consolidated-report/generate-report.mjs \
  "$report_inputs" \
  output/reporte-consolidado
```

Encontrarás `consolidated-report.json` y `consolidated-report.md` en `output/reporte-consolidado/`. La generación local no publica en GitHub y no hace llamadas adicionales al proveedor. Los HTML de Playwright pertenecen a API/chatbot.

Utiliza resultados de una misma ejecución. El generador rechaza fuentes duplicadas o ambiguas, ignora las copias del HTML y registra evidencia ausente. Las rutas de salida se sobrescriben al repetir las pruebas; conserva las evidencias que quieras comparar.

## Cómo interpretar los resultados

| Estado | Significado |
| --- | --- |
| `PASS` | La evaluación no detectó un problema material. |
| `FAIL` | Se registró un hallazgo funcional. |
| `REVIEW` | Hay un juicio que requiere revisión o una evaluación no disponible; consulta la evidencia. |
| `BLOCKED` | Un error técnico impidió completar el escenario. |
| `SKIPPED` | El caso fue omitido explícitamente. |
| `MISSING` / `ERROR` | Falta evidencia o es inválida/inconsistente. |
| `FLAKY` | El reporte identifica un caso inestable; conserva sus intentos. |

**Un FAIL funcional del LLM puede formar parte de una ejecución correcta.** El objetivo es detectar y documentar problemas. El ejecutor conjunto del Ejercicio 1 devuelve éxito cuando los cinco escenarios tienen seis intercambios y seis juicios válidos disponibles, incluidos FAIL/REVIEW funcionales. El proceso individual conserva sus códigos: `0` para PASS, `1` para FAIL/REVIEW y `2` para BLOCKED; un error inesperado también puede devolver `1`.

Completar los seis intercambios no implica resolver toda la necesidad del usuario. Cada juicio registra utilidad, aclaraciones, contexto y resolución acumulada: `resolved`, `partial`, `unresolved` o `not_applicable`. Si falta el juicio final o la conversación está incompleta, queda `unknown`. Sin juicios válidos, las métricas de calidad son `null`.

Las métricas por escenario incluyen coherencia, retención de contexto, alucinación, seguridad y completitud. `security_score` incluye turnos benignos. `hallucination_rate`, `demonstrably_false_rate` y `unsupported_rate` expresan las clasificaciones del juez sobre respuestas, no sobre afirmaciones individuales.

Los porcentajes globales usan los cinco escenarios más los casos API/UI. El denominador de ejecutadas incluye PASS, FAIL, REVIEW y FLAKY. La tasa de turnos LLM con hallazgos cuenta cada turno una vez; la tasa de detectores semánticos y la de reglas auxiliares tienen denominadores separados. Los tiempos de respuesta y las duraciones de pruebas también se presentan por separado.

Revisa los argumentos del juez contra la conversación y la base de conocimiento antes de considerar un hallazgo como defecto confirmado.

## Bonus y validación del evaluador

Los detectores cubren alucinación, prompt injection, toxicidad, pérdida de contexto y uso incorrecto de herramientas. El asistente tiene herramientas de consulta de la base local y una herramienta para interpretar GET/POST/DELETE sin ejecutar peticiones. Las consultas de pedidos requieren que el usuario haya proporcionado su ID; se trabaja con datos ficticios.

El consolidado muestra las fuentes en `bonus.transverse` y el detalle por turno en `bonus.assessments`. Un extractor sin coincidencia no elimina un juicio válido. La cobertura de reglas se conserva en `bonus.rulesTransverse` y sus discrepancias con el juez en `bonus.disagreements`. Prompt injection cuenta los ataques identificados con juicio válido y excluye los turnos benignos.

API audita contratos HTTP e integridad. Docs guarda el intercambio de Hola y homepage añade tres sondas de nombre, recuerdo/producto e inyección, con su historial en `bonus-probes.json`. Las herramientas internas de Botpress no son observables desde la UI. Sin una referencia verificable o una traza, una comprobación puede quedar `NOT_EVALUATED` o `NOT_APPLICABLE`.

Para comprobar el esquema, métricas, herramientas y reglas localmente, sin consumir tokens:

```bash
npm run test:evaluator
npm run test:bonus
```

Para validar al juez contra diez casos con expectativas previamente definidas:

```bash
npm run validate:evaluator
```

Este último comando **consume tokens del evaluador configurado**. Guarda `validation-results.json` y `.md` en `output/exercise1-JSON/evaluator-validation/`, con resultados esperados/observados, discrepancias y conteos TP/TN/FP/FN. Se ejecuta por separado y no reemplaza las conversaciones reales. Los controles fijos de reglas se publican en `detector-validation.json`; ninguno de estos conjuntos pequeños demuestra precisión universal.

## Organización del código y evidencias

| Carpeta | Responsabilidad |
| --- | --- |
| `exercise-1-llm-evaluation/` | Escenarios, proveedores, conversación y evaluación |
| `exercise-2-api-testing/` | Pruebas e instrumentación de API |
| `exercise-3-chatbot-testing/` | Automatización de los chatbots |
| `exercise-4-cicd/` | Ejecutores y validaciones del pipeline |
| `exercise-5-consolidated-report/` | Consolidación, detectores y publicación |
| `output/` | Resultados y evidencias agrupados por ejercicio |

La publicación utiliza commits `[skip ci]`, push normal y controles por número de ejecución/intento para evitar que un run antiguo reemplace resultados recientes. Los artefactos se suben antes del commit, por si los permisos o la protección de rama impiden publicar.

`output/evidence-manifest.json` relaciona los archivos con su ejecución y commit. Las copias API publicadas en Git ocultan credenciales en JSON y trazas ZIP; los artefactos originales de Actions permanecen intactos. `history/` y el historial de Git conservan evidencias anteriores; una validación manual del juez no se presenta como recién ejecutada automáticamente.

La documentación está en español. Los comandos, variables, campos JSON y citas originales conservan su idioma para que puedas relacionarlos directamente con el código y las evidencias.
