import { test, expect, type Page } from '@playwright/test';

const HOME_URL = 'https://botpress.com/';
const UI_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 60_000;

// Observed on the live homepage: the launcher opens an embedded Shadow DOM
// widget. The other iframes belong to forms/tracking, not this chat.
const launcher = (page: Page) => page.locator('.bpFabWrapper');
const input = (page: Page) =>
  page.getByRole('textbox', { name: 'Message Input', exact: true });
const botName = (page: Page) =>
  page.getByRole('heading', { name: 'Botpress', exact: true, level: 2 });
const incoming = (page: Page) =>
  page.locator('.bpMessageContainer[data-direction="incoming"]');

async function loadHomepage(page: Page): Promise<void> {
  const response = await page.goto(HOME_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  expect(response).not.toBeNull();
  expect(response!.status()).toBe(200);
  await expect(page).toHaveTitle(/Botpress/i);
  await expect(launcher(page)).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

async function openChat(page: Page): Promise<void> {
  if (!(await input(page).isVisible())) {
    await launcher(page).click();
  }
  await expect(input(page)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(input(page)).toBeEnabled({ timeout: UI_TIMEOUT_MS });
  await expect(botName(page)).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

test.describe('Exercise 3 - Botpress homepage chatbot', () => {
  test('HOME-001: Load homepage and verify floating launcher', async ({ page }) => {
    await loadHomepage(page);
  });

  test('HOME-002: Open, close and reopen the chatbot', async ({ page }) => {
    await loadHomepage(page);
    await openChat(page);

    await test.step('Close using the real header control', async () => {
      await page.getByRole('button', {
        name: 'Close Chatbot Button',
        exact: true,
      }).click();
      await expect(input(page)).toBeHidden({ timeout: UI_TIMEOUT_MS });
      await expect(botName(page)).toBeHidden({ timeout: UI_TIMEOUT_MS });
      await expect(launcher(page)).toBeVisible({ timeout: UI_TIMEOUT_MS });
    });

    await test.step('Reopen using the floating launcher', async () => {
      await openChat(page);
    });
  });

  test('HOME-003: Validate the displayed bot name', async ({ page }) => {
    await loadHomepage(page);
    await openChat(page);
    await expect(botName(page)).toHaveText('Botpress');
  });

  test('HOME-004: Send Hola and record a new bot response and latency',
    async ({ page }, testInfo) => {
      test.setTimeout(150_000);
      await loadHomepage(page);
      await openChat(page);

      // Wait for the welcome message BEFORE taking the baseline.
      // The welcome must never count as the response to Hola.
      await expect(incoming(page).first()).toBeVisible({
        timeout: UI_TIMEOUT_MS,
      });
      await expect(incoming(page).first()).toHaveAttribute('data-loaded', 'true');
      await expect(incoming(page).first()).toContainText(/\S/);
      const initialBotMessages = await incoming(page).count();

      await input(page).fill('Hola');
      const startedAt = performance.now();
      await input(page).press('Enter');

      const userMessage = page
        .locator('.bpMessageBlocksBubble[data-direction="outgoing"]')
        .filter({ hasText: /^Hola$/ });
      await expect(userMessage).toBeVisible({ timeout: UI_TIMEOUT_MS });

      await expect.poll(() => incoming(page).count(), {
        timeout: RESPONSE_TIMEOUT_MS,
        message: 'A new bot message must arrive after sending Hola.',
      }).toBeGreaterThan(initialBotMessages);

      const response = incoming(page).nth(initialBotMessages);
      await expect(response).toBeVisible({ timeout: RESPONSE_TIMEOUT_MS });
      await expect(response).toHaveAttribute('data-loaded', 'true', {
        timeout: RESPONSE_TIMEOUT_MS,
      });
      await expect(response).toContainText(/\S/, { timeout: RESPONSE_TIMEOUT_MS });
      const responseTimeMs = Math.round(performance.now() - startedAt);

      const evidence = {
        testId: 'HOME-004',
        pageUrl: page.url(),
        widgetStructure: 'Shadow DOM',
        botName: await botName(page).innerText(),
        userMessage: await userMessage.innerText(),
        assistantResponse: await response.innerText(),
        responseTimeMs,
        measuredAt: new Date().toISOString(),
        measurement: 'From immediately before pressing Enter until a new, loaded bot message with visible text is observed. Includes UI and assertion overhead.',
      };

      const jsonPath = testInfo.outputPath('homepage-response-time.json');
      const screenshotPath = testInfo.outputPath('homepage-conversation.png');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(jsonPath, JSON.stringify(evidence, null, 2), 'utf8');
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach('Homepage conversation and latency', {
        path: jsonPath, contentType: 'application/json',
      });
      await testInfo.attach('Homepage conversation', {
        path: screenshotPath, contentType: 'image/png',
      });
      console.log(JSON.stringify(evidence));
    },
  );
});
