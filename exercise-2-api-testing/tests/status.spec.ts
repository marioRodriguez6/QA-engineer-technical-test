import 'dotenv/config';
import { test, expect } from './api-fixture.js';

const API_BASE_URL = (
  process.env.GOAL_TRACKER_API_URL ??
  'https://goal-tracker-api.onrender.com'
).replace(/\/$/, '');

const PASSWORD = 'TestPassword123!';
const TEST_EMAIL = `qa.test.${Date.now()}@example.com`;
const TEST_NAME = 'QA Automation Test';

let authToken: string;

let firstGoalId: string;
let secondGoalId: string;

let firstGoalData: {
  title: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
};

let secondGoalData: {
  title: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
};

test.describe.serial('Exercise 2 - Goal Tracker API', () => {
  test('API-001: Verify API operational status', async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/v1/status`,
      { timeout: 120_000 }
    );

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/application\/json/);

    const body = await response.json();

    expect(body.status).toBe('OPERATIONAL');
  });
  test('API-002: Register a new user', async ({ request }) => {
    const response = await request.post(
      `${API_BASE_URL}/api/v1/auth/register`,
      {
        data: {
          name: TEST_NAME,
          email: TEST_EMAIL,
          password: PASSWORD,
        },
      }
    );

    expect(response.status()).toBe(201);

    const body = await response.json();

    expect(body.user).toBeDefined();
    expect(body.user.name).toBe(TEST_NAME);
    expect(body.user.email).toBe(TEST_EMAIL);
  });
  test('API-003: Login with valid credentials', async ({ request }) => {
    const response = await request.post(
      `${API_BASE_URL}/api/v1/auth/login`,
      {
        data: {
          email: TEST_EMAIL,
          password: PASSWORD,
        },
      }
    );

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body).toHaveProperty('token');
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);

    authToken = body.token;
  });
  test('API-004: Reject login with invalid credentials', async ({ request }) => {
    const response = await request.post(
      `${API_BASE_URL}/api/v1/auth/login`,
      {
        data: {
          email: TEST_EMAIL,
          password: 'WrongPassword123!',
        },
      }
    );

    expect(response.status()).toBe(401);

    const body = await response.json();

    expect(body).toEqual({
      msg: 'Invalid Credentials',
    });
  });
  test('API-005: Create the first goal', async ({ request }) => {
    const goalPayload = {
      title: 'Complete QA technical assessment',
      description: 'Finish the API testing exercise.',
      status: 'to-do',
      priority: 'high',
    };

    const response = await request.post(
      `${API_BASE_URL}/api/v1/goals`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        data: goalPayload,
      }
    );

    expect(response.status()).toBe(201);

    const body = await response.json();

    expect(body.goal).toBeDefined();
    expect(body.goal.title).toBe(goalPayload.title);
    expect(body.goal.description).toBe(goalPayload.description);
    expect(body.goal.status).toBe(goalPayload.status);
    expect(body.goal.priority).toBe(goalPayload.priority);

    expect(body.goal._id).toBeDefined();
    expect(typeof body.goal._id).toBe('string');
    expect(body.goal._id.length).toBeGreaterThan(0);

    expect(body.goal.createdAt).toBeDefined();

    const createdAt = Date.parse(body.goal.createdAt);

    expect(Number.isNaN(createdAt)).toBe(false);

    firstGoalId = body.goal._id;

    firstGoalData = {
      title: body.goal.title,
      description: body.goal.description,
      status: body.goal.status,
      priority: body.goal.priority,
      createdAt: body.goal.createdAt,
    };
  });
  test('API-006: Create a second goal with a different ID', async ({ request }) => {
    const goalPayload = {
      title: 'Practice API automation',
      description: 'Validate API endpoints using Playwright.',
      status: 'in-progress',
      priority: 'medium',
    };

    const response = await request.post(
      `${API_BASE_URL}/api/v1/goals`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        data: goalPayload,
      }
    );

    expect(response.status()).toBe(201);

    const body = await response.json();

    expect(body.goal).toBeDefined();
    expect(body.goal.title).toBe(goalPayload.title);
    expect(body.goal.description).toBe(goalPayload.description);
    expect(body.goal.status).toBe(goalPayload.status);
    expect(body.goal.priority).toBe(goalPayload.priority);

    expect(body.goal._id).toBeDefined();
    expect(typeof body.goal._id).toBe('string');
    expect(body.goal._id.length).toBeGreaterThan(0);

    expect(body.goal.createdAt).toBeDefined();

    const createdAt = Date.parse(body.goal.createdAt);

    expect(Number.isNaN(createdAt)).toBe(false);

    secondGoalId = body.goal._id;

    secondGoalData = {
      title: body.goal.title,
      description: body.goal.description,
      status: body.goal.status,
      priority: body.goal.priority,
      createdAt: body.goal.createdAt,
    };
    expect(secondGoalId).not.toBe(firstGoalId);
  });
  test('API-007: Retrieve the first goal by ID', async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/v1/goals/${firstGoalId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.goal).toBeDefined();
    expect(body.goal._id).toBe(firstGoalId);

    expect(body.goal.title).toBe(firstGoalData.title);
    expect(body.goal.description).toBe(firstGoalData.description);
    expect(body.goal.status).toBe(firstGoalData.status);
    expect(body.goal.priority).toBe(firstGoalData.priority);
    expect(body.goal.createdAt).toBe(firstGoalData.createdAt);
  });
  test('API-008: Retrieve the second goal by ID', async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/v1/goals/${secondGoalId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.goal).toBeDefined();
    expect(body.goal._id).toBe(secondGoalId);

    expect(body.goal.title).toBe(secondGoalData.title);
    expect(body.goal.description).toBe(secondGoalData.description);
    expect(body.goal.status).toBe(secondGoalData.status);
    expect(body.goal.priority).toBe(secondGoalData.priority);
    expect(body.goal.createdAt).toBe(secondGoalData.createdAt);
  });
  test('API-009: Retrieve the complete list of created goals', async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/v1/goals`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(Array.isArray(body.goals)).toBe(true);
    expect(body.goals).toHaveLength(2);

    const goalIds = body.goals.map(
      (goal: { _id: string }) => goal._id
    );

    expect(goalIds).toContain(firstGoalId);
    expect(goalIds).toContain(secondGoalId);
  });
  test('API-010: Delete the first goal', async ({ request }) => {
    const response = await request.delete(
      `${API_BASE_URL}/api/v1/goals/${firstGoalId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.msg).toBe('Success! Goal removed.');
  });
  test('API-011: Verify the deleted goal cannot be retrieved', async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/v1/goals/${firstGoalId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    expect(response.status()).toBe(404);
  });
});

