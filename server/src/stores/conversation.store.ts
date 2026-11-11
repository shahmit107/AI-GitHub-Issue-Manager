import { randomUUID } from 'node:crypto';
import type { BaseMessage } from '@langchain/core/messages';

export class ConversationStore {
  private readonly conversations = new Map<string, BaseMessage[]>();

  createConversation(): string {
    const sessionId = randomUUID();
    this.conversations.set(sessionId, []);
    return sessionId;
  }

  hasConversation(sessionId: string): boolean {
    return this.conversations.has(sessionId);
  }

  getHistory(sessionId: string): BaseMessage[] {
    return [...this.requireHistory(sessionId)];
  }

  appendMessages(sessionId: string, messages: BaseMessage[]): void {
    const history = this.requireHistory(sessionId);
    for (const message of messages) {
      history.push(message);
    }
  }

  deleteConversation(sessionId: string): boolean {
    return this.conversations.delete(sessionId);
  }

  private requireHistory(sessionId: string): BaseMessage[] {
    const history = this.conversations.get(sessionId);
    if (history === undefined) {
      throw new Error(`Conversation not found: ${sessionId}`);
    }
    return history;
  }
}

export const conversationStore = new ConversationStore();
