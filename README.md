# Prueba técnica QA Engineer — NerdsAi

Evaluación técnica de agentes conversacionales, pruebas de API y de interfaz de chatbot, CI/CD y generación de un reporte consolidado.

## Estructura del proyecto

| Ruta | Propósito |
| --- | --- |
| `exercise-1-llm-evaluation/` | Evaluación conversacional con distintos proveedores de LLM |
| `exercise-2-api-testing/` | Pruebas automatizadas de Goal Tracker API |
| `exercise-3-chatbot-testing/` | Pruebas de los chatbots de Botpress Docs y de la página principal |
| `exercise-4-cicd/` | Ejecutor de CI para los cinco escenarios de LLM |
| `exercise-5-consolidated-report/` | Generador, pruebas y reportes consolidados conservados |
| `.github/workflows/qa.yml` | Workflow de GitHub Actions |
| `output/` | Reportes y evidencias generados |

Ejecuta todos los comandos desde la raíz del repositorio. Los ejemplos utilizan Bash en Linux o Ubuntu WSL. Los nombres de archivos, variables, comandos, campos JSON y estados del código se conservan en inglés.

## Requisitos

- Node.js 22 y npm.
- Acceso a Internet para instalar dependencias y consultar los servicios externos.
- Chromium instalado mediante Playwright para las pruebas de chatbot.
- Credenciales y cuota suficiente de los proveedores elegidos para los escenarios de LLM.
- Al utilizar Ollama, un servidor accesible con los modelos seleccionados instalados.

Las pruebas de API y chatbot no requieren credenciales de proveedores de LLM.

## Instalación

Clona el repositorio e instala las versiones fijadas de las dependencias:

```bash
git clone https://github.com/marioRodriguez6/QA-engineer-technical-test.git
cd QA-engineer-technical-test
npm ci
```

Instala Chromium y sus dependencias del sistema:

```bash
npx playwright install --with-deps chromium
```

Valida TypeScript y la sintaxis del ejecutor de CI:

```bash
npx tsc --noEmit
node --check exercise-4-cicd/run-llm-ci.mjs
```

## Ejercicio 1 — Evaluación conversacional de LLM

El ejercicio separa tres roles:

- **Usuario simulado (`Simulated User`):** genera los mensajes del escenario.
- **Asistente (`Assistant`):** responde utilizando la base de conocimiento de Nerds Store.
- **Evaluador (`Evaluator`):** analiza cada respuesta del asistente con el historial completo.

Cada rol puede utilizar OpenAI, Anthropic, Groq, Gemini u Ollama de forma independiente mediante la fábrica de proveedores.

### Configuración del entorno

Para la primera configuración, copia la plantilla:

```bash
cp .env.example .env
```

Si ya existe `.env`, edítalo sin sobrescribirlo. La plantilla contiene:

```dotenv
SIMULATED_USER_PROVIDER=groq
SIMULATED_USER_MODEL=qwen/qwen3.8-27b

ASSISTANT_PROVIDER=groq
ASSISTANT_MODEL=qwen/qwen3.8-27b

EVALUATOR_PROVIDER=groq
EVALUATOR_MODEL=openai/gpt-oss-20b

GROQ_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

OLLAMA_BASE_URL=http://localhost:11434/api
```

Agrega credenciales únicamente para los proveedores seleccionados:

| Valor del proveedor | Configuración necesaria |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |
| `ollama` | Servidor accesible y modelos instalados |

Configura los tres pares de proveedor/modelo. Los identificadores de modelo deben estar disponibles para el proveedor y la cuenta utilizados. No subas `.env` ni claves de API al repositorio.

### Ejecutar un escenario individual

| Escenario | Identificador |
| --- | --- |
| Consulta simple | `simple-query` |
| Cambio de tema | `topic-change` |
| Información ambigua | `ambiguous-information` |
| Memoria conversacional | `conversational-memory` |
| Seguridad y prompt injection | `prompt-injection` |

Utiliza el identificador correspondiente:

```bash
npx tsx exercise-1-llm-evaluation/runner.ts simple-query
npx tsx exercise-1-llm-evaluation/runner.ts topic-change
npx tsx exercise-1-llm-evaluation/runner.ts ambiguous-information
npx tsx exercise-1-llm-evaluation/runner.ts conversational-memory
npx tsx exercise-1-llm-evaluation/runner.ts prompt-injection
```

Cada escenario busca completar seis intercambios de usuario y asistente, conservando el historial. Su reporte se guarda en:

```text
output/llm/<scenario-id>.json
```

Volver a ejecutar un escenario reemplaza su reporte en esa ruta. Conserva copias de las evidencias anteriores si necesitas comparar ejecuciones.

### Ejecutar los cinco escenarios

```bash
node exercise-4-cicd/run-llm-ci.mjs
```

Los escenarios se ejecutan secuencialmente. Los reportes, registros y resumen quedan en `output/ci/llm/`; el resumen es `output/ci/llm/execution-summary.json`.

Antes de cada escenario, el ejecutor elimina el reporte previo para evitar aceptar resultados antiguos.

### Interpretación de resultados

| Estado del código | Significado |
| --- | --- |
| `PASS` | Todas las evaluaciones esperadas aprobaron |
| `FAIL` | Al menos una evaluación detectó un problema funcional |
| `REVIEW` | No hubo un FAIL, pero existe un juicio que requiere revisión o falta una evaluación |
| `BLOCKED` | Un error del proveedor o de infraestructura impidió completar el escenario |

Un `FAIL` funcional no detiene los turnos restantes. Una salida inválida del evaluador se registra como evaluación no disponible; los errores reconocidos de infraestructura pueden detener el escenario con `BLOCKED`.

El ejecutor individual devuelve:

- `0` para `PASS`.
- `1` para `FAIL`, `REVIEW` o un error inesperado de ejecución.
- `2` para `BLOCKED`.

El ejecutor de los cinco escenarios distingue esos veredictos de la finalización técnica:

| Situación | Resultado del job LLM |
| --- | --- |
| Cinco escenarios con seis intercambios y seis juicios disponibles cada uno, sean `PASS`, `FAIL` o `REVIEW` | Exitoso, código `0` |
| Cuota agotada, autenticación, timeout, respuestas o evaluaciones ausentes/inválidas, o errores de ejecución | Fallido, código `1` |

También se valida la consistencia entre reportes, veredictos y códigos de salida de los procesos individuales. Un `REVIEW` disponible es parte del flujo; un `REVIEW` causado por una evaluación ausente es una ejecución incompleta. Los veredictos originales nunca se convierten en PASS para conseguir un workflow verde. Las fallas de TypeScript, API o chatbot siguen haciendo fallar sus propios jobs.

### Limitaciones de los proveedores

La ejecución depende de la disponibilidad del servicio, el acceso al modelo y la cuota de la cuenta. Un límite de peticiones o una cuota diaria agotada es un bloqueo técnico, no evidencia de mala calidad del asistente.

Aumentar `maxOutputTokens` no recupera una cuota agotada. Revisa el error registrado antes de reintentar. Las respuestas y juicios pueden variar entre ejecuciones; contrasta los hallazgos con la base de conocimiento antes de considerarlos defectos confirmados.

### Validación del evaluador y definición de métricas

Los cinco escenarios reales de seis intercambios constituyen el ejercicio principal. Cada juicio nuevo registra utilidad de 0 a 100, necesidad y pertinencia de aclaraciones, una bandera explícita de error material de contexto, resolución acumulada de la necesidad del usuario (`resolved`, `partial`, `unresolved`, `not_applicable`) y una explicación de experiencia de usuario basada en evidencias.

La síntesis final utiliza los juicios existentes con referencias a los turnos; no hace otra llamada al proveedor. Completar seis intercambios no significa resolver la necesidad del usuario. Si falta el juicio final o la ejecución está incompleta, la resolución queda como desconocida.

| Campo del código | Definición |
| --- | --- |
| `hallucination_rate` | Respuestas señaladas por el juez o clasificadas como falsas/sin respaldo, divididas entre los juicios válidos |
| `demonstrably_false_rate` | Respuestas que el juez clasifica como contradictorias con la base de conocimiento |
| `unsupported_rate` | Respuestas con afirmaciones que el juez considera sin respaldo |
| `security_score` | Porcentaje de juicios válidos sin una falla de seguridad; incluye turnos benignos |

Sin evaluaciones válidas, las métricas de calidad son `null`. Los reportes históricos conservan sus definiciones y los campos de experiencia de usuario ausentes permanecen desconocidos.

Ejecuta las pruebas deterministas de esquema, agregación y comparación de referencias, sin consumir tokens:

```bash
npm run test:evaluator
```

Ejecuta la calibración real del juez por separado cuando dispongas de credenciales y cuota:

```bash
npm run validate:evaluator
```

Este último comando consume tokens del evaluador. Utiliza diez casos fijos, con controles positivos y negativos de exactitud factual, memoria, seguridad y toxicidad. Las expectativas y justificaciones se definen antes de ejecutar en `exercise-1-llm-evaluation/tests/evaluator-cases.ts`. Estos casos validan al evaluador; no reemplazan las conversaciones reales ni exigen puntuaciones numéricas exactas.

Los resultados quedan en `output/llm/evaluator-validation/validation-results.json` y `.md`. Conservan resultados esperados/observados, discrepancias, cobertura y conteos TP/TN/FP/FN por categoría. La tasa de falsos positivos es FP/(FP+TN) y la de falsos negativos FN/(FN+TP); sin muestras válidas se utiliza `null`. Un bloqueo del proveedor detiene las llamadas restantes y registra `NOT_RUN`, separado de una falla del detector. Este conjunto pequeño no demuestra sensibilidad o especificidad universales.

CI ejecuta automáticamente solo las pruebas sin llamadas al proveedor. La calibración real permanece separada para evitar consumo adicional y sus métricas no se mezclan con las de los cinco escenarios. Si una respuesta nueva del juez omite campos requeridos o contiene valores inválidos, la evaluación queda no disponible; no se inventan valores para cumplir el esquema.

## Ejercicio 2 — Pruebas de API

Servicio evaluado: https://goal-tracker-api.onrender.com

La suite contiene once pruebas secuenciales: estado del servicio, registro, autenticación correcta e incorrecta, creación de dos objetivos, consulta e integridad de datos, listado y eliminación con verificación de que el objetivo eliminado ya no se puede consultar.

```bash
npm run test:api
```

Comando equivalente:

```bash
npx playwright test exercise-2-api-testing/tests/status.spec.ts
```

Para otra instancia compatible de la API:

```bash
GOAL_TRACKER_API_URL=https://your-api.example.com npm run test:api
```

Las pruebas crean un usuario y datos nuevos en el servicio seleccionado. Comparten autenticación e identificadores de objetivos; ejecuta la suite completa para respetar esas dependencias.

### Reportes de API

Rutas predeterminadas:

```text
output/playwright-report/
output/playwright-results.json
```

Abre el reporte de Playwright:

```bash
npm run test:api:report
```

Para separar las evidencias de API:

```bash
QA_REPORT_DIR=output/ci/api npx playwright test exercise-2-api-testing/tests/status.spec.ts
npx playwright show-report output/ci/api/html
```

Este HTML pertenece al ejercicio 2; no es el reporte consolidado del ejercicio 5.

## Ejercicio 3 — Pruebas de chatbot

El ejercicio contiene dos suites independientes:

| Suite | Página | Cobertura |
| --- | --- | --- |
| `tests/botpress-docs/chatbot.spec.ts` | https://botpress.com/docs/ | Página propuesta: carga, apertura/cierre del panel, Hola y latencia; `CHATBOT-003` permanece omitido |
| `tests/botpress-homepage/chatbot.spec.ts` | https://botpress.com/ | Cobertura adicional: botón flotante, apertura/cierre/reapertura, nombre Botpress, Hola y latencia |

La página principal observada utiliza un Shadow DOM abierto, no un iframe de chat. Los localizadores de Playwright atraviesan esas raíces. El cargador comienza en `window.load`; la suite espera ese evento antes de comprobar el botón y registra ambos tiempos.

### Ejecutar las suites

Docs:

```bash
QA_REPORT_DIR=output/ci/chatbot-docs npx playwright test exercise-3-chatbot-testing/tests/botpress-docs/
```

Página principal:

```bash
QA_REPORT_DIR=output/ci/chatbot-homepage npx playwright test exercise-3-chatbot-testing/tests/botpress-homepage/
```

Agrega `--headed` para ver el navegador. Para ejecutar solamente el caso de apertura/cierre de Docs:

```bash
QA_REPORT_DIR=output/ci/chatbot-docs npx playwright test exercise-3-chatbot-testing/tests/botpress-docs/ --grep CHATBOT-002
```

Para reunir ambas suites en un reporte local:

```bash
QA_REPORT_DIR=output/ci/chatbot npx playwright test exercise-3-chatbot-testing/tests/
```

No requieren credenciales de Groq. Cada prueba tiene un contexto aislado del navegador. `QA_REPORT_DIR` cambia las rutas de evidencias, no las aserciones.

### Reportes y evidencias

Cada directorio de Playwright contiene `html/`, `results.json` y `test-results/`:

| Suite | Directorio |
| --- | --- |
| Docs | `output/ci/chatbot-docs/` |
| Página principal | `output/ci/chatbot-homepage/` |
| Ejecución local conjunta | `output/ci/chatbot/` |

```bash
npx playwright show-report output/ci/chatbot-docs/html
npx playwright show-report output/ci/chatbot-homepage/html
```

Se conservan capturas, videos y trazas de las pruebas de navegador ejecutadas, independientemente del resultado. Las pruebas de API no generan videos de navegador. Para inspeccionar una traza, pasa su ruta real a `npx playwright show-trace`.

La conversación de Docs también escribe `output/chatbot/chatbot-conversation.png` y `output/chatbot/chatbot-response-time.json`; estas rutas fijas se sobrescriben en ejecuciones posteriores.

`HOME-004` guarda y adjunta `homepage-conversation.png` y `homepage-response-time.json` en su directorio de resultados. Espera el mensaje de bienvenida antes de establecer la línea base y exige un mensaje entrante nuevo después de Hola. La latencia llega hasta el primer texto visible de la nueva respuesta, incluye sobrecarga de interfaz/aserciones y no mide todos los mensajes posteriores ni impone un SLA no documentado.

Una ejecución local verificada aprobó los cuatro casos de la página principal sin omisiones ni reintentos y registró 5.114 ms hasta la primera respuesta nueva. Ese valor describe únicamente aquella ejecución; conserva su evidencia por separado.

### Limitación conocida de cobertura

`CHATBOT-003` está omitido porque la interfaz de Docs inspeccionada no expone un nombre de bot distintivo. Validar el nombre en la página principal no sustituye ese requisito de Docs: es cobertura complementaria sobre otra página. La omisión permanece visible.

Ambas suites dependen de páginas externas en vivo. Revisa cambios de interfaz o respuesta con sus evidencias antes de modificar las aserciones.

## Ejercicio 4 — CI/CD

Archivo: `.github/workflows/qa.yml`.

Se ejecuta mediante push, pull request o inicio manual desde GitHub Actions. Los commits con `[skip ci]` omiten los eventos de push/pull request correspondientes.

El flujo instala dependencias, valida TypeScript y las pruebas sin proveedor, ejecuta API, ambos chatbots y los cinco escenarios LLM, sube evidencias y genera el reporte consolidado incluso después de fallas previas.

Después de TypeScript, los jobs de API, chatbot y LLM pueden ejecutarse independientemente. Dentro del job LLM, los cinco escenarios se ejecutan secuencialmente.

### Proveedores y secrets de GitHub Actions

La configuración local y la de GitHub son independientes:

| Ejecución | Configuración de proveedor/modelo | Credenciales |
| --- | --- | --- |
| Terminal local | `.env` privado en la raíz | Claves dentro de ese `.env` |
| GitHub Actions | Variables del workflow y entrada manual `llm_provider` | Secrets de Actions del repositorio |

Clonar o crear un fork no copia los secrets. Para evaluar localmente basta con un `.env` propio. Para ejecutar Actions en un fork o copia, agrega tus propios secrets allí. Una persona autorizada para iniciar el workflow de este repositorio utiliza los secrets ya configurados en él.

Agrega las claves en **Settings → Secrets and variables → Actions → New repository secret**:

| Proveedor | Nombre del secret |
| --- | --- |
| Groq | `GROQ_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Gemini | `GEMINI_API_KEY` |
| Ollama | Este adaptador no requiere clave; el ejecutor debe alcanzar el servidor y el modelo instalado |

Solo necesitan credenciales los proveedores seleccionados. El workflow actual pasa las claves de Groq y Anthropic al paso LLM. Para otros proveedores también debes pasar su secret en el workflow; crearlo por sí solo no configura un rol.

En **Run workflow**, selecciona `groq` o `anthropic` en `llm_provider`. Esa selección se aplica a los tres roles. Groq utiliza Qwen para usuario/asistente y GPT-OSS para evaluador; Anthropic utiliza Haiku 5.5 en los tres. Los eventos de push/pull request utilizan Groq por defecto. El selector actual no ofrece una combinación de proveedores.

Pueden coexistir `GROQ_API_KEY` y `ANTHROPIC_API_KEY`: almacenar ambas no llama automáticamente a ambos servicios ni activa un proveedor de respaldo.

### Dos proveedores en la misma ejecución

La aplicación permite elegir proveedor/modelo por rol. Ejemplo: usuario y asistente en Groq, evaluador en Anthropic.

```dotenv
SIMULATED_USER_PROVIDER=groq
SIMULATED_USER_MODEL=qwen/qwen3.8-27b
ASSISTANT_PROVIDER=groq
ASSISTANT_MODEL=qwen/qwen3.8-27b
EVALUATOR_PROVIDER=anthropic
EVALUATOR_MODEL=claude-haiku-5-5

GROQ_API_KEY=your_private_groq_key
ANTHROPIC_API_KEY=your_private_anthropic_key
```

Para ejecutar esa combinación localmente:

```bash
node exercise-4-cicd/run-llm-ci.mjs
```

Para usarla en GitHub Actions, modifica `.github/workflows/qa.yml` antes de iniciar:

1. Agrega ambos secrets de Actions.
2. Sustituye las seis variables de rol de `jobs.llm.env` por los valores explícitos del ejemplo, o implementa entradas independientes por rol. No deben depender todas del único selector `llm_provider`.
3. Actualiza `Validate selected provider secret` para comprobar ambos proveedores. La comprobación actual del asistente presupone un mismo proveedor en los tres roles.
4. Conserva ambos secrets en el paso de ejecución:

```yaml
env:
  GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Estas instrucciones describen una personalización; no existe un modo mixto ya habilitado en el selector. No pegues claves reales en YAML. Cambiar `.env` local no cambia CI.

En cada turno, el usuario configurado genera su mensaje, el asistente responde y el evaluador juzga con el historial. Cada rol usa la clave de su proveedor. Los roles que comparten proveedor también comparten la cuota de esa cuenta. No se ejecutan automáticamente dos proveedores para comparar ni se cambia a otro cuando se agota la cuota. Cada proveedor cobra su consumo por separado.

Los reportes conservan proveedor/modelo de cada rol. Cuota o timeout en cualquiera de los servicios es un bloqueo técnico, no un defecto funcional del asistente.

Los jobs LLM se omiten en pull requests originados en forks porque no tienen acceso a los secrets. El Ollama del equipo del evaluador no es accesible como `localhost` desde un ejecutor alojado por GitHub; utiliza un servidor accesible o un ejecutor propio adecuado.

### Comprobaciones locales antes de publicar

Sin llamadas a proveedores:

```bash
npx tsc --noEmit
node --check exercise-4-cicd/run-llm-ci.mjs
npm run test:evaluator
node --test exercise-4-cicd/inspect-report.test.mjs exercise-5-consolidated-report/generate-report.test.mjs exercise-5-consolidated-report/publish-reports.test.mjs
git diff --check
```

Pruebas de servicios externos:

```bash
QA_REPORT_DIR=output/ci/api npx playwright test exercise-2-api-testing/tests/status.spec.ts
QA_REPORT_DIR=output/ci/chatbot npx playwright test exercise-3-chatbot-testing/tests/
```

Escenarios LLM, con credenciales y cuota disponibles:

```bash
node exercise-4-cicd/run-llm-ci.mjs
```

Estos comandos comprueban componentes localmente. El workflow completo de GitHub Actions se ejecuta en GitHub.

### Artefactos de CI

Abre la ejecución en **Actions** y descarga sus artefactos:

```text
qa-api-<run-id>-<attempt>
qa-chatbot-docs-<run-id>-<attempt>
qa-chatbot-homepage-<run-id>-<attempt>
qa-llm-<run-id>-<attempt>
qa-consolidated-report-<run-id>-<attempt>
```

La retención configurada es de 30 días. El artefacto LLM incluye reportes JSON individuales, registros por escenario y `execution-summary.json`.

Un workflow rojo puede indicar una aserción fallida de API/UI, una evaluación no disponible, un bloqueo del proveedor o un error de ejecución. Un veredicto funcional LLM `FAIL` o `REVIEW` disponible no lo vuelve rojo por sí solo. Revisa las evidencias del job correspondiente.

## Ejercicio 5 — Reporte consolidado automático

El job final `consolidated` depende de TypeScript, API/UI y LLM, y utiliza `if: always()`. Genera un reporte nuevo aunque los jobs previos fallen o se omitan. Lee solamente artefactos del identificador de ejecución e intento actuales; nunca utiliza reportes históricos como respaldo.

Produce únicamente dos formatos de reporte:

- `output/consolidated-report.md`: presentación en español, también visible en el resumen del job.
- `output/consolidated-report.json`: resultados estructurados, juicios originales y trazabilidad.

Ambos se incluyen en `qa-consolidated-report-<run-id>-<attempt>`, con retención de 30 días. El ejercicio 5 no genera un reporte HTML. Los HTML de Playwright pertenecen a los ejercicios 2 y 3.

### Contenido e interpretación

El reporte comienza con estados separados de ejecución y calidad observada. Incluye:

- Una tabla de los cinco escenarios LLM: coherencia, señales de alucinación, seguridad y completitud.
- Resumen de API y de ambos chatbots, con resultados de cada caso desplegables.
- Métricas globales de PASS/FAIL, cobertura de conversaciones y juicios, necesidades resueltas y tasa de turnos señalados.
- Tiempos promedio separados de respuesta del asistente, evaluador y chatbot, y duración de pruebas.
- Detección de alucinaciones, prompt injection, toxicidad, errores de contexto y estado de instrumentación de tool calling.
- Hallazgos, errores técnicos, omisiones y fuentes de evidencia.

Las conversaciones, justificaciones y análisis extensos se presentan en secciones desplegables. Las citas del código y las respuestas/juicios originales se conservan en su idioma para no alterar la evidencia. Los nombres de campos JSON y estados del código permanecen en inglés.

Los estados `PASS`, `FAIL`, `REVIEW`, `BLOCKED`, `SKIPPED`, `FLAKY`, `MISSING` y `ERROR` son distintos. Un caso requerido omitido deja la evaluación de calidad incompleta aunque CI termine correctamente. Una evaluación ausente o inválida hace fallar la validación del reporte después de escribir los archivos, para permitir su subida como evidencia.

Las métricas de calidad utilizan juicios válidos. Se separan afirmaciones falsas y sin respaldo. Una puntuación de contexto menor de 100 no demuestra por sí sola un defecto. Los detectores semánticos de API/UI figuran como `NOT_EVALUATED`; el uso incorrecto de herramientas figura como `NOT_IMPLEMENTED` porque no hay herramientas configuradas ni trazas de llamadas. Consolidar resultados no implementa detectores faltantes ni demuestra la precisión del juez.

La consolidación no necesita credenciales, dependencias npm externas ni nuevas llamadas a LLM.

### Conservación de reportes

Después de subir el artefacto, el job publica las carpetas en la rama de origen con `[skip ci]`:

| Carpeta | Política de actualización |
| --- | --- |
| `exercise-5-consolidated-report/lastRun/` | Último reporte generado, incluso con fallas, bloqueos o evidencia incompleta |
| `exercise-5-consolidated-report/LastSuccesfulrun/` | Última evaluación completa, incluso con veredictos funcionales `FAIL` o `REVIEW` disponibles; excluye bloqueos técnicos |

Cada carpeta contiene `consolidated-report.md`, `consolidated-report.json` y `publication.json`. Este último es metadato de auditoría, no otro formato de reporte: guarda número de ejecución, intento, commit y enlace. Se conserva intencionalmente la escritura `LastSuccesfulrun`.

Una ejecución completa exige cinco escenarios con seis respuestas y seis juicios disponibles cada uno. Un `FAIL` por alucinación/seguridad o un `REVIEW` disponible puede actualizar ambas carpetas sin cambiar el veredicto. Cuota agotada, timeout, juicio ausente, conversación incompleta o evidencia inválida actualizan solo `lastRun`. TypeScript y API/UI deben terminar correctamente. Las omisiones explícitas permanecen visibles y no equivalen a cubrir todos los requisitos.

El primer reporte histórico de `LastSuccesfulrun` correspondía a la ejecución 43268157726, anterior a la cobertura de la página principal y sin JSON generado. Las ejecuciones elegibles posteriores lo reemplazan con ambos formatos. Los reportes anteriores permanecen en el historial de Git y en sus artefactos durante la retención.

La publicación utiliza push normal, sin forzarlo, y reintenta si la rama cambia concurrentemente. Número de ejecución e intento evitan que una ejecución antigua sustituya otra más reciente. Solo se publican las carpetas de reportes. Los pull requests del mismo repositorio publican en su rama de origen; los de forks conservan únicamente artefactos porque su token no puede escribir allí. La protección de ramas o falta de permisos puede impedir publicar; primero se sube el artefacto y la falla de publicación queda visible.

### Generación local desde artefactos descargados

Extrae los artefactos de una misma ejecución e intento en estas rutas, conservando sus directorios internos:

| Directorio de entrada | Contenido |
| --- | --- |
| `output/ci/consolidated-inputs/llm/` | JSON de escenarios y `execution-summary.json` |
| `output/ci/consolidated-inputs/api/` | `results.json` de API y evidencias |
| `output/ci/consolidated-inputs/chatbot-docs/` | `results.json`, latencia y evidencias de Docs |
| `output/ci/consolidated-inputs/chatbot-homepage/` | `results.json`, latencia y evidencias de la página principal |

```bash
node --test exercise-5-consolidated-report/generate-report.test.mjs exercise-5-consolidated-report/publish-reports.test.mjs
node exercise-5-consolidated-report/generate-report.mjs output/ci/consolidated-inputs output
```

El generador localiza JSON recursivamente e ignora copias adjuntas dentro de reportes HTML. Rechaza fuentes duplicadas o ambiguas. No combines artefactos de distintas ejecuciones. Un reintento parcial sin artefactos del intento actual se registra como evidencia ausente.

El antiguo reporte situado directamente en `exercise-5-consolidated-report/` se trasladó a `LastSuccesfulrun/`. Los reportes conservados no se utilizan como entradas del generador.

No puede garantizarse la generación si GitHub no inicia el job, falla la preparación del entorno o se termina forzosamente el workflow. Un commit con `[skip ci]` no ejecuta este job.

## Ejecutar juntas las suites de Playwright

```bash
npm test
npx playwright show-report output/playwright-report
```

`npm test` no ejecuta los cinco escenarios conversacionales LLM. Ejecútalos por separado con el ejecutor del ejercicio 1 o el del ejercicio 4.

## Gestión de evidencias

Una ejecución posterior puede sobrescribir reportes que usan la misma ruta. Para conservar varias, utiliza directorios únicos:

```bash
QA_REPORT_DIR=output/runs/chatbot-$(date -u +%Y%m%dT%H%M%SZ) npx playwright test exercise-3-chatbot-testing/tests/
```

La captura y el JSON de latencia personalizados de Docs siguen utilizando rutas fijas bajo `output/chatbot/`; guarda copias adicionales cuando sea necesario.

Reporta resultados con evidencias de la ejecución correspondiente. Un reporte histórico aprobado no demuestra que una ejecución posterior fallida o bloqueada haya aprobado.

## Anthropic: ejecución local y manual de CI

Para utilizar Anthropic en los tres roles, configura tu `.env` privado:

```dotenv
ANTHROPIC_API_KEY=your_private_key
SIMULATED_USER_PROVIDER=anthropic
SIMULATED_USER_MODEL=claude-haiku-5-5
ASSISTANT_PROVIDER=anthropic
ASSISTANT_MODEL=claude-haiku-5-5
EVALUATOR_PROVIDER=anthropic
EVALUATOR_MODEL=claude-haiku-5-5
```

Usa `npm run validate:evaluator` para validar contra referencias o `node exercise-4-cicd/run-llm-ci.mjs` para los cinco escenarios reales. Ambos consumen crédito. No compartas ni publiques la clave.

En Actions, agrega `ANTHROPIC_API_KEY` y selecciona `anthropic` en `llm_provider` desde **Run workflow**. La selección `groq` conserva la otra configuración. Push y pull request utilizan Groq por defecto. Actions no lee tu `.env` local.

Para `claude-haiku-5-5`, las opciones del proveedor omiten parámetros de muestreo y desactivan explícitamente `thinking` para respetar presupuestos cortos de respuesta. Los demás proveedores conservan sus temperaturas. Esto no modifica veredictos ni elimina hallazgos. Revisa siempre la evidencia y el consumo de la ejecución concreta antes de asumir que otra configuración tendrá el mismo resultado.
