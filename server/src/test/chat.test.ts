import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import app from '../app.js';
import { conversationStore } from '../stores/conversation.store.js';

// Keep provider calls local: this test never uses a real API key or paid request.
test('chat API validates requests and returns LLM answers safely', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalFetch = globalThis.fetch;
  const sessionIds: string[] = [];
  let providerCalls = 0;
  let providerStatus = 200;
  let providerErrorType = 'UNAUTHENTICATED';
  let finishReason = 'STOP';
  let blockPrompt = false;
  let noCandidates = false;
  let expectedQuestion = 'What is a GitHub issue?';
  let providerText = 'A GitHub issue tracks a task or bug.';

  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).hostname, 'generativelanguage.googleapis.com');
    const body = await request.json();
    assert.equal(body.contents[0].parts[0].text, expectedQuestion);
    assert.match(body.systemInstruction.parts[0].text, /GitHub issue manager/);
    assert.ok(new URL(request.url).pathname.endsWith('/models/test-chat-model:generateContent'));
    assert.equal(request.headers.get('x-goog-api-key'), 'test-key-not-real');
    providerCalls += 1;

    if (providerStatus !== 200) {
      return Response.json({ error: { message: 'Private provider details', status: providerErrorType, code: providerStatus } }, {
        status: providerStatus,
      });
    }

    if (blockPrompt) {
      return Response.json({ promptFeedback: { blockReason: 'SAFETY' } });
    }

    if (noCandidates) {
      return Response.json({ candidates: [] });
    }

    return Response.json({
      candidates: [{
        finishReason,
        content: { role: 'model', parts: [{ text: providerText }] },
      }],
    });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  async function sendQuestion(body: Record<string, unknown>) {
    // A fresh session keeps each provider-error scenario independent.
    const created = await originalFetch(`${url}/api/chat/sessions`, { method: 'POST' });
    assert.equal(created.status, 201);
    const { sessionId } = await created.json() as { sessionId: string };
    sessionIds.push(sessionId);
    return originalFetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, sessionId }),
    });
  }

  try {
    process.env.GEMINI_MODEL = 'test-chat-model';
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    const health = await originalFetch(`${url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    for (const body of [{}, { question: 42 }, { question: '  ' }, { question: 'a'.repeat(10_001) }]) {
      const response = await sendQuestion(body);
      assert.equal(response.status, 400);
    }
    assert.equal(providerCalls, 0);

    const malformed = await originalFetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'The request body must contain valid JSON.' });

    process.env.GEMINI_API_KEY = '';
    const missingKey = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(missingKey.status, 503);
    assert.equal(providerCalls, 0);

    process.env.GEMINI_API_KEY = 'test-key-not-real';
    process.env.GEMINI_MODEL = '';
    const missingModel = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(missingModel.status, 503);
    assert.equal(providerCalls, 0);
    process.env.GEMINI_MODEL = 'test-chat-model';

    const success = await sendQuestion({ question: '  What is a GitHub issue?  ' });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { answer: providerText, sessionId: sessionIds.at(-1) });
    assert.equal(providerCalls, 1);

    // User braces stay literal instead of becoming prompt-template variables.
    expectedQuestion = 'Explain {issue} and {question} placeholders.';
    const braces = await sendQuestion({ question: expectedQuestion });
    assert.equal(braces.status, 200);
    assert.deepEqual(await braces.json(), { answer: providerText, sessionId: sessionIds.at(-1) });
    expectedQuestion = 'What is a GitHub issue?';

    providerStatus = 401;
    const failure = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(failure.status, 502);
    assert.equal((await failure.text()).includes('Private provider details'), false);

    providerStatus = 429;
    providerErrorType = 'RESOURCE_EXHAUSTED';
    const quota = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(quota.status, 429);
    assert.equal((await quota.json()).code, 'llm_quota_exceeded');

    providerStatus = 200;
    providerText = '';
    const empty = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(empty.status, 502);
    assert.equal((await empty.json()).code, 'response_empty');

    providerText = 'Partial answer';
    finishReason = 'MAX_TOKENS';
    const incomplete = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(incomplete.status, 502);
    assert.equal((await incomplete.json()).code, 'response_incomplete');

    finishReason = 'SAFETY';
    const blocked = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(blocked.status, 422);
    assert.equal((await blocked.json()).code, 'response_blocked');

    blockPrompt = true;
    const blockedPrompt = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(blockedPrompt.status, 422);
    assert.equal((await blockedPrompt.json()).code, 'response_blocked');
    blockPrompt = false;

    noCandidates = true;
    const noCandidateResponse = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(noCandidateResponse.status, 502);
    assert.equal((await noCandidateResponse.json()).code, 'response_empty');
    noCandidates = false;

    providerStatus = 404;
    providerErrorType = 'NOT_FOUND';
    const missingModelResponse = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(missingModelResponse.status, 502);
    assert.equal((await missingModelResponse.json()).code, 'model_unavailable');

    providerStatus = 503;
    providerErrorType = 'UNAVAILABLE';
    const unavailable = await sendQuestion({ question: 'What is a GitHub issue?' });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, 'provider_unavailable');
  } finally {
    for (const sessionId of sessionIds) {
      conversationStore.deleteConversation(sessionId);
    }
    if (originalModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = originalModel;
    }
    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalKey;
    }
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

