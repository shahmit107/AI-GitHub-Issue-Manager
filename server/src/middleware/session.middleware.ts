import type { NextFunction, Request, Response } from 'express';
import { conversationStore } from '../stores/conversation.store.js';

export interface SessionLocals {
  sessionId: string;
}

export function requireSession(
  req: Request,
  res: Response<unknown, SessionLocals>,
  next: NextFunction,
): void {
  const sessionId: unknown = req.body?.sessionId;

  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    res.status(400).json({ error: 'A non-empty sessionId is required. Create a session first.' });
    return;
  }

  if (!conversationStore.hasConversation(sessionId)) {
    res.status(404).json({ error: 'Conversation not found. Create a new session first.' });
    return;
  }

  res.locals.sessionId = sessionId;
  next();
}
