
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DOCS_URL = 'https://botpress.com/docs';
const OUTPUT_DIR = join(process.cwd(), 'output', 'chatbot');

test.describe('Exercise 3 - Botpress Docs chatbot', () => {

  test('CHATBOT-001: Load documentation page and verify chatbot widget', async ({ page }) => {
    const response = await page.goto(DOCS_URL, {
      waitUntil: 'domcontentloaded',
    });

    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);

    await expect(page).toHaveTitle(/Botpress documentation/i);
    await expect(
      page.getByRole('button', { name: 'Ask Docs' })
    ).toBeVisible();
  });

  test('CHATBOT-002: Open and close the chatbot panel', async ({ page }) => {
    await page.goto(DOCS_URL, { waitUntil: 'domcontentloaded' });

    const openButton = page.getByRole('button', { name: 'Ask Docs' });
    const chatInput = page.locator(
      'textarea[placeholder="Ask a question..."]'
    );

    await expect(openButton).toBeVisible();
    await openButton.click();

    await expect(chatInput).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Close panel' })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Close panel' }).click();

    await expect(chatInput).toBeHidden();
    await expect(openButton).toBeVisible();
  });

  test.skip(
    'CHATBOT-003: Validate the chatbot name',
    async () => {
      // BLOCKED: the inspected UI only exposes the generic text
      // "You're chatting with an AI agent."
      // No proper bot name was identified.
      // Enable this test when the application exposes a verifiable name.
    }
  );

  test('CHATBOT-004: Send Hola, validate response and measure latency', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(DOCS_URL, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Ask Docs' }).click();

    const chatInput = page.locator(
      'textarea[placeholder="Ask a question..."]'
    );
    const sendButton = page.getByRole('button', { name: 'Send' });

    await expect(chatInput).toBeVisible();

    await chatInput.fill('Hola');
    await expect(sendButton).toBeEnabled();

    // Start measuring immediately before sending.
    const startedAt = Date.now();

    await sendButton.click();

    const userMessage = page.getByText('Hola', { exact: true });

    const firstResponse = page.getByText(
      "I'm here specifically for Botpress documentation questions.",
      { exact: true }
    );

    const secondResponse = page.getByText(
      'Ask me about Studio, the ADK, Webchat, the HTTP APIs, integrations, or Desk and I can help.',
      { exact: true }
    );

    await expect(userMessage).toBeVisible({ timeout: 60_000 });
    await expect(firstResponse).toBeVisible({ timeout: 60_000 });

    // Stop measuring when the first assistant response is visible.
    const responseTimeMs = Date.now() - startedAt;

    await expect(secondResponse).toBeVisible({ timeout: 15_000 });

    await mkdir(OUTPUT_DIR, { recursive: true });

    const evidence = {
      testId: 'CHATBOT-004',
      pageUrl: DOCS_URL,
      userMessage: 'Hola',
      assistantResponse: [
        "I'm here specifically for Botpress documentation questions.",
        'Ask me about Studio, the ADK, Webchat, the HTTP APIs, integrations, or Desk and I can help.',
      ],
      responseTimeMs,
      measuredAt: new Date().toISOString(),
      measurement:
        'Time from immediately before clicking Send until the first assistant response paragraph is visible.',
    };

    await writeFile(
      join(OUTPUT_DIR, 'chatbot-response-time.json'),
      JSON.stringify(evidence, null, 2),
      'utf-8'
    );

    await page.screenshot({
      path: join(OUTPUT_DIR, 'chatbot-conversation.png'),
      fullPage: false,
    });

    console.log(`CHATBOT-004 response time: ${responseTimeMs} ms`);
  });
});

