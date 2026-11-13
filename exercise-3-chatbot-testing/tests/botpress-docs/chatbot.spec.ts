import { detectBonus, conversationEvidence } from '../../../exercise-5-consolidated-report/detectors/bonus.mjs';
import {
  test,
  expect,
  type Page,
} from '@playwright/test';

import {
  mkdir,
  writeFile,
} from 'node:fs/promises';

import { join } from 'node:path';

const DOCS_URL = 'https://botpress.com/docs';

const OUTPUT_DIR = process.env.QA_REPORT_DIR?.trim() ||
  join(process.cwd(), 'output', 'exercise3-chatbot', 'docs');

const UI_TIMEOUT_MS = 30_000;

function getChatInput(page: Page) {
  return page.locator(
    'textarea[placeholder="Ask a question..."]',
  );
}

function getChatToggle(page: Page) {
  return page.getByRole(
    'button',
    {
      name: 'Ask Docs',
      exact: true,
    },
  );
}

async function loadDocumentation(
  page: Page,
): Promise<void> {
  const response = await page.goto(
    DOCS_URL,
    {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    },
  );

  expect(response).not.toBeNull();
  expect(response!.status()).toBe(200);

  await expect(page).toHaveTitle(
    /Botpress documentation/i,
    { timeout: UI_TIMEOUT_MS },
  );

  await expect(
    getChatToggle(page),
  ).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  });
}

async function waitForChatbotReady(
  page: Page,
): Promise<void> {
  await expect(
    page.locator(
      'astro-island[component-export="AssistantToggle"]:not([ssr])',
    ),
  ).toHaveCount(1, {
    timeout: UI_TIMEOUT_MS,
  });

  await expect(
    page.locator(
      'astro-island[component-export="AssistantPanel"]:not([ssr])',
    ),
  ).toHaveCount(1, {
    timeout: UI_TIMEOUT_MS,
  });

  const toggle = getChatToggle(page);

  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();

  await expect(toggle).toHaveAttribute(
    'aria-pressed',
    /^(true|false)$/,
    { timeout: UI_TIMEOUT_MS },
  );

  await expect.poll(
    async () => {
      const buttonState =
        await toggle.getAttribute('aria-pressed');

      const panelState =
        await page.locator('html').getAttribute(
          'data-assistant-panel-open',
        );

      return (
        (buttonState === 'true' ||
          buttonState === 'false') &&
        buttonState === panelState
      );
    },
    {
      timeout: UI_TIMEOUT_MS,
      message:
        'The chatbot toggle and panel state must agree.',
    },
  ).toBe(true);
}

async function assertChatbotState(
  page: Page,
  open: boolean,
): Promise<void> {
  const expectedState = String(open);

  await expect(
    getChatToggle(page),
  ).toHaveAttribute(
    'aria-pressed',
    expectedState,
    { timeout: UI_TIMEOUT_MS },
  );

  await expect(
    page.locator('html'),
  ).toHaveAttribute(
    'data-assistant-panel-open',
    expectedState,
    { timeout: UI_TIMEOUT_MS },
  );

  if (open) {
    await expect(
      getChatInput(page),
    ).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    });
  } else {
    await expect(
      getChatInput(page),
    ).toBeHidden({
      timeout: UI_TIMEOUT_MS,
    });
  }
}

async function setChatbotOpen(
  page: Page,
  open: boolean,
): Promise<void> {
  await waitForChatbotReady(page);

  const toggle = getChatToggle(page);

  const currentState =
    await toggle.getAttribute('aria-pressed');

  console.log(
    `Chatbot state: current=${currentState}, requested=${open}`,
  );

  if (currentState !== String(open)) {
    await toggle.click();
  }

  await assertChatbotState(page, open);
}

test.describe(
  'Exercise 3 - Botpress Docs chatbot',
  () => {
    test(
      'CHATBOT-001: Load documentation page and verify chatbot widget',
      async ({ page }) => {
        await loadDocumentation(page);
      },
    );

    test(
      'CHATBOT-002: Open and close the chatbot panel',
      async ({ page }) => {
        await loadDocumentation(page);

        await test.step(
          'Establish a closed initial state',
          async () => {
            await setChatbotOpen(page, false);
          },
        );

        await test.step(
          'Open the panel using Ask Docs',
          async () => {
            await getChatToggle(page).click();
            await assertChatbotState(page, true);
          },
        );

        await test.step(
          'Close the panel using Ask Docs',
          async () => {
            await getChatToggle(page).click();
            await assertChatbotState(page, false);
          },
        );
      },
    );

    test.skip(
      'CHATBOT-003: Validate the chatbot name',
      async () => {
        /*
         * BLOCKED: la UI inspeccionada solo muestra
         * "You're chatting with an AI agent."
         *
         * No se identificó un nombre propio verificable.
         * Este caso permanece omitido explícitamente.
         */
      },
    );

    test(
      'CHATBOT-004: Send Hola, validate response and measure latency',
      async ({ page }, testInfo) => {
        test.setTimeout(150_000);

        await loadDocumentation(page);
        await setChatbotOpen(page, true);

        const chatInput = getChatInput(page);

        const sendButton = page.getByRole(
          'button',
          {
            name: 'Send',
            exact: true,
          },
        );

        await chatInput.fill('Hola');

        await expect(
          sendButton,
        ).toBeEnabled();

        const userMessage = page.getByText(
          'Hola',
          { exact: true },
        );

        const firstResponse = page.getByText(
          "I'm here specifically for Botpress documentation questions.",
          { exact: true },
        );

        const secondResponse = page.getByText(
          'Ask me about Studio, the ADK, Webchat, the HTTP APIs, integrations, or Desk and I can help.',
          { exact: true },
        );

        const startedAt = Date.now();

        await sendButton.click();

        await expect(
          userMessage,
        ).toBeVisible({
          timeout: 60_000,
        });

        await expect(
          firstResponse,
        ).toBeVisible({
          timeout: 60_000,
        });

        const responseTimeMs =
          Date.now() - startedAt;

        await expect(
          secondResponse,
        ).toBeVisible({
          timeout: 15_000,
        });

        const assistantResponse = [
          await firstResponse.innerText(),
          await secondResponse.innerText(),
        ];

        await mkdir(
          OUTPUT_DIR,
          { recursive: true },
        );

        const bonusInput = conversationEvidence({scope:'chatbot-docs',id:'CHATBOT-004',history:[{role:'user',message:'Hola'}],userMessage:'Hola',response:assistantResponse.join(' ')});
        const bonusPath = testInfo.outputPath('bonus-evidence.json');
        await writeFile(bonusPath,JSON.stringify({scope:'chatbot-docs',records:[{input:bonusInput,analysis:detectBonus(bonusInput)}]},null,2));
        await testInfo.attach('Docs bonus evidence',{path:bonusPath,contentType:'application/json'});
        const evidence = {
          testId: 'CHATBOT-004',
          pageUrl: page.url(),
          userMessage: await userMessage.innerText(),
          assistantResponse,
          responseTimeMs,
          measuredAt: new Date().toISOString(),
          measurement:
            'Time from immediately before clicking Send until the first assistant response paragraph is visible.',
        };

        await writeFile(
          join(
            OUTPUT_DIR,
            'chatbot-response-time.json',
          ),
          JSON.stringify(evidence, null, 2),
          'utf8',
        );

        await page.screenshot({
          path: join(
            OUTPUT_DIR,
            'chatbot-conversation.png',
          ),
          fullPage: false,
        });

        console.log(
          `CHATBOT-004 response time: ${responseTimeMs} ms`,
        );
      },
    );
  },
);



