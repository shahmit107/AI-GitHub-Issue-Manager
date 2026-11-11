import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import app from '../app.js';
import { conversationStore } from '../stores/conversation.store.js';

type ProviderRequest = {
  contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
};

// Provider requests are mocked; only the local Express server is contacted.
test('session chat sends history to Gemini and saves successful exchanges', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalFetch = globalThis.fetch;
  const sessionIds: string[] = [];
  const requests: Array<Array<{ role: string; text: string }>> = [];
  let providerText = 'A login issue.';
  let providerStatus = 200;
  let finishReason = 'STOP';
  let providerGate: Promise<void> | undefined;
  let onProviderStart: (() => void) | undefined;

  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).hostname, 'generativelanguage.googleapis.com');
    assert.equal(request.headers.get('x-goog-api-key'), 'test-key-not-real');
    const body = await request.json() as ProviderRequest;
    requests.push(body.contents.map((content) => ({
      role: content.role,
      text: content.parts.map((part) => part.text ?? '').join(''),
    })));
    onProviderStart?.();
    await providerGate;

    if (providerStatus !== 200) {
      return Response.json({ error: { message: 'Private provider details', status: 'RESOURCE_EXHAUSTED', code: providerStatus } }, {
        status: providerStatus,
      });
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

  async function sendQuestion(body: unknown) {
    return originalFetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function createSession(): Promise<string> {
    const response = await originalFetch(`${url}/api/chat/sessions`, { method: 'POST' });
    assert.equal(response.status, 201);
    const body = await response.json() as { sessionId: string };
    assert.equal(typeof body.sessionId, 'string');
    sessionIds.push(body.sessionId);
    assert.equal(conversationStore.hasConversation(body.sessionId), true);
    assert.deepEqual(conversationStore.getHistory(body.sessionId), []);
    return body.sessionId;
  }

  try {
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    process.env.GEMINI_MODEL = 'test-chat-model';
    const first = await createSession();
    const second = await createSession();
    assert.notEqual(first, second);
    assert.equal(requests.length, 0);

    await t.test('validates sessions before contacting the provider', async () => {
      for (const sessionId of [undefined, null, 42, false, {}, [], '', '   ']) {
        const response = await sendQuestion({ sessionId, question: 'Hello' });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          error: 'A non-empty sessionId is required. Create a session first.',
        });
      }
      const noBody = await originalFetch(`${url}/api/chat`, { method: 'POST' });
      assert.equal(noBody.status, 400);
      const response = await sendQuestion({ sessionId: 'unknown-session', question: 'Hello' });
      assert.equal(response.status, 404);
      assert.equal(conversationStore.hasConversation('unknown-session'), false);
      assert.equal(requests.length, 0);
    });

    await t.test('sends earlier human and AI turns before a follow-up question', async () => {
      providerText = '  A login issue.  ';
      const response = await sendQuestion({ sessionId: first, question: '  My issue is {login} failing.  ' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { sessionId: first, answer: 'A login issue.' });
      assert.deepEqual(requests.at(-1), [{ role: 'user', text: 'My issue is {login} failing.' }]);
      const history = conversationStore.getHistory(first);
      assert.ok(history[0] instanceof HumanMessage);
      assert.ok(history[1] instanceof AIMessage);
      assert.deepEqual(history.map((message) => message.content), ['My issue is {login} failing.', 'A login issue.']);

      providerText = 'Check the browser console.';
      const followUp = await sendQuestion({ sessionId: first, question: 'How do I debug it?' });
      assert.equal(followUp.status, 200);
      assert.deepEqual(await followUp.json(), { sessionId: first, answer: providerText });
      assert.deepEqual(requests.at(-1), [
        { role: 'user', text: 'My issue is {login} failing.' },
        { role: 'model', text: 'A login issue.' },
        { role: 'user', text: 'How do I debug it?' },
      ]);
      assert.equal(conversationStore.getHistory(first).length, 4);
    });

    await t.test('keeps sessions separate and rejects question-only requests', async () => {
      const firstHistory = conversationStore.getHistory(first);
      providerText = 'A separate conversation.';
      const response = await sendQuestion({ sessionId: second, question: 'A different issue' });
      assert.equal(response.status, 200);
      assert.deepEqual(requests.at(-1), [{ role: 'user', text: 'A different issue' }]);
      assert.deepEqual(conversationStore.getHistory(first), firstHistory);
      const secondHistory = conversationStore.getHistory(second);

      const callCount = requests.length;
      const independent = await sendQuestion({ question: 'An independent question' });
      assert.equal(independent.status, 400);
      assert.deepEqual(await independent.json(), {
        error: 'A non-empty sessionId is required. Create a session first.',
      });
      assert.equal(requests.length, callCount);
      assert.deepEqual(conversationStore.getHistory(first), firstHistory);
      assert.deepEqual(conversationStore.getHistory(second), secondHistory);
    });

    await t.test('leaves history unchanged on invalid requests and missing configuration', async () => {
      const history = conversationStore.getHistory(first);
      const callCount = requests.length;
      const invalid = await sendQuestion({ sessionId: first, question: ' ' });
      assert.equal(invalid.status, 400);
      process.env.GEMINI_API_KEY = '';
      const missingKey = await sendQuestion({ sessionId: first, question: 'Hello' });
      assert.equal(missingKey.status, 503);
      process.env.GEMINI_API_KEY = 'test-key-not-real';
      process.env.GEMINI_MODEL = '';
      const missingModel = await sendQuestion({ sessionId: first, question: 'Hello' });
      assert.equal(missingModel.status, 503);
      process.env.GEMINI_MODEL = 'test-chat-model';
      assert.equal(requests.length, callCount);
      assert.deepEqual(conversationStore.getHistory(first), history);
    });

    await t.test('leaves history unchanged on provider errors and allows a successful retry', async () => {
      const history = conversationStore.getHistory(first);
      const failures = [
        { status: 429, text: 'Ignored', reason: 'STOP', expected: 429 },
        { status: 200, text: '', reason: 'STOP', expected: 502 },
        { status: 200, text: 'Partial', reason: 'MAX_TOKENS', expected: 502 },
        { status: 200, text: 'Blocked', reason: 'SAFETY', expected: 422 },
      ];
      for (const failure of failures) {
        providerStatus = failure.status;
        providerText = failure.text;
        finishReason = failure.reason;
        const response = await sendQuestion({ sessionId: first, question: 'Failed question' });
        assert.equal(response.status, failure.expected);
        assert.deepEqual(conversationStore.getHistory(first), history);
      }
      providerStatus = 200;
      finishReason = 'STOP';
      providerText = 'Retry succeeded.';
      const retry = await sendQuestion({ sessionId: first, question: 'Retry question' });
      assert.equal(retry.status, 200);
      assert.deepEqual(requests.at(-1)?.map((message) => message.text), [
        ...history.map((message) => message.content),
        'Retry question',
      ]);
      assert.equal(conversationStore.getHistory(first).length, history.length + 2);
    });

    await t.test('rejects overlapping turns in one session while allowing other sessions', async () => {
      const history = conversationStore.getHistory(first);
      let releaseProvider: () => void = () => {};
      const started = new Promise<void>((resolve) => { onProviderStart = resolve; });
      providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
      providerText = 'Completed turn.';
      const pending = sendQuestion({ sessionId: first, question: 'Pending question' });
      try {
        await started;
        const callCount = requests.length;
        const overlap = await sendQuestion({ sessionId: first, question: 'Overlapping question' });
        assert.equal(overlap.status, 409);
        assert.equal(requests.length, callCount);
        assert.deepEqual(conversationStore.getHistory(first), history);

        // Only the first provider call stays paused.
        providerGate = undefined;
        onProviderStart = undefined;
        const other = await sendQuestion({ sessionId: second, question: 'Parallel session' });
        assert.equal(other.status, 200);
      } finally {
        providerGate = undefined;
        onProviderStart = undefined;
        releaseProvider();
        const response = await pending;
        assert.equal(response.status, 200);
      }
      assert.equal(conversationStore.getHistory(first).length, history.length + 2);
      const next = await sendQuestion({ sessionId: first, question: 'Next question' });
      assert.equal(next.status, 200);
    });

    await t.test('rejects deleted sessions without contacting the provider', async () => {
      const callCount = requests.length;
      conversationStore.deleteConversation(first);
      const response = await sendQuestion({ sessionId: first, question: 'Hello again' });
      assert.equal(response.status, 404);
      assert.equal(requests.length, callCount);
    });
  } finally {
    for (const sessionId of sessionIds) {
      conversationStore.deleteConversation(sessionId);
    }
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve(); });
    });
  }
});
