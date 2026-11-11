import assert from 'node:assert/strict';
import test from 'node:test';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import {
  ConversationStore,
  conversationStore,
} from '../stores/conversation.store.js';

test('creates unique UUID sessions with empty histories', () => {
  const store = new ConversationStore();
  const first = store.createConversation();
  const second = store.createConversation();

  for (const sessionId of [first, second]) {
    assert.match(
      sessionId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(store.hasConversation(sessionId), true);
    assert.deepEqual(store.getHistory(sessionId), []);
  }
  assert.notEqual(first, second);
});

test('appends messages in order while preserving existing history', () => {
  const store = new ConversationStore();
  const sessionId = store.createConversation();
  const first = new HumanMessage('Hello');
  const second = new AIMessage('Hi!');
  const third = new HumanMessage('How are you?');

  store.appendMessages(sessionId, [first]);
  store.appendMessages(sessionId, [second, third]);
  store.appendMessages(sessionId, []);

  assert.deepEqual(store.getHistory(sessionId), [first, second, third]);
});

test('returns shallow history copies that cannot change the stored array', () => {
  const store = new ConversationStore();
  const sessionId = store.createConversation();
  const message = new HumanMessage('Hello');
  store.appendMessages(sessionId, [message]);

  const snapshot = store.getHistory(sessionId);
  assert.notStrictEqual(snapshot, store.getHistory(sessionId));
  assert.strictEqual(snapshot[0], message);
  snapshot.pop();
  snapshot.push(new AIMessage('Outside the store'));
  assert.deepEqual(store.getHistory(sessionId), [message]);

  const earlierHistory = store.getHistory(sessionId);
  store.appendMessages(sessionId, [new AIMessage('Hi!')]);
  assert.deepEqual(earlierHistory, [message]);
});

test('does not retain the caller messages array', () => {
  const store = new ConversationStore();
  const sessionId = store.createConversation();
  const message = new HumanMessage('Hello');
  const messages = [message];

  store.appendMessages(sessionId, messages);
  messages.length = 0;

  assert.deepEqual(store.getHistory(sessionId), [message]);
});

test('deletes existing conversations and reports whether they existed', () => {
  const store = new ConversationStore();
  const sessionId = store.createConversation();
  store.appendMessages(sessionId, [new HumanMessage('Hello')]);

  assert.equal(store.deleteConversation(sessionId), true);
  assert.equal(store.hasConversation(sessionId), false);
  assert.equal(store.deleteConversation(sessionId), false);
  assert.throws(() => store.getHistory(sessionId), {
    message: `Conversation not found: ${sessionId}`,
  });
  assert.throws(() => store.appendMessages(sessionId, []), {
    message: `Conversation not found: ${sessionId}`,
  });
});

test('rejects unknown and empty session IDs without creating conversations', () => {
  const store = new ConversationStore();

  for (const sessionId of ['unknown-session', '']) {
    assert.equal(store.hasConversation(sessionId), false);
    assert.throws(() => store.getHistory(sessionId), {
      message: `Conversation not found: ${sessionId}`,
    });
    for (const messages of [[], [new HumanMessage('Hello')]]) {
      assert.throws(() => store.appendMessages(sessionId, messages), {
        message: `Conversation not found: ${sessionId}`,
      });
    }
    assert.equal(store.hasConversation(sessionId), false);
    assert.equal(store.deleteConversation(sessionId), false);
  }
});

test('keeps multiple conversation histories independent', () => {
  const store = new ConversationStore();
  const first = store.createConversation();
  const second = store.createConversation();
  const firstMessage = new HumanMessage('First conversation');
  const secondMessage = new HumanMessage('Second conversation');

  store.appendMessages(first, [firstMessage]);
  assert.deepEqual(store.getHistory(second), []);
  store.appendMessages(second, [secondMessage]);
  assert.deepEqual(store.getHistory(first), [firstMessage]);
  assert.deepEqual(store.getHistory(second), [secondMessage]);

  store.deleteConversation(first);
  assert.equal(store.hasConversation(second), true);
  assert.deepEqual(store.getHistory(second), [secondMessage]);
});

test('exports a shared instance and supports isolated store instances', () => {
  assert.ok(conversationStore instanceof ConversationStore);
  const isolated = new ConversationStore();
  const sessionId = conversationStore.createConversation();

  try {
    assert.equal(conversationStore.hasConversation(sessionId), true);
    assert.equal(isolated.hasConversation(sessionId), false);
  } finally {
    conversationStore.deleteConversation(sessionId);
  }
});
