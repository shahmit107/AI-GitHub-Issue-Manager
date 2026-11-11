import type { Request, Response } from 'express';
import type { SessionLocals } from '../middleware/session.middleware.js';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { conversationStore } from '../stores/conversation.store.js';
import { askLLM, LLMResponseError } from '../chains/chat.chain.js';

const activeSessions = new Set<string>();

export function createSession(_req: Request, res: Response): void {
  const sessionId = conversationStore.createConversation();
  res.status(201).json({ sessionId });
}

export async function handleChat(req: Request, res: Response<unknown, SessionLocals>): Promise<void> {
  const { sessionId } = res.locals;
  const question: unknown = req.body?.question;

  if (typeof question !== 'string' || question.trim() === '') {
    res.status(400).json({ error: 'Please provide a non-empty question.' });
    return;
  }

  if (question.length > 10_000) {
    res.status(400).json({ error: 'The question must be 10,000 characters or fewer.' });
    return;
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    res.status(503).json({ error: 'Set GEMINI_API_KEY in server/.env first.' });
    return;
  }

  if (!process.env.GEMINI_MODEL?.trim()) {
    res.status(503).json({ error: 'Set GEMINI_MODEL in server/.env first.' });
    return;
  }

  if (activeSessions.has(sessionId)) {
    res.status(409).json({ error: 'A response is already being generated for this session. Wait before sending another question.' });
    return;
  }

  try {
    activeSessions.add(sessionId);
    const history = conversationStore.getHistory(sessionId);
    const trimmedQuestion = question.trim();
    const answer = await askLLM(trimmedQuestion, history);

    conversationStore.appendMessages(sessionId, [
      new HumanMessage(trimmedQuestion),
      new AIMessage(answer),
    ]);
    res.json({ answer, sessionId });
  } catch (error) {
    if (error instanceof LLMResponseError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }

    const providerStatus = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;

    if (providerStatus === 404) {
      res.status(502).json({
        error: 'The configured Gemini model is unavailable. Check GEMINI_MODEL in server/.env.',
        code: 'model_unavailable',
      });
      return;
    }

    if (providerStatus === 503) {
      res.status(503).json({
        error: 'Gemini is temporarily unavailable. Try again later.',
        code: 'provider_unavailable',
      });
      return;
    }
    if (providerStatus === 429) {
      res.status(429).json({
        error: 'Gemini free-tier rate or daily quota limit reached. Wait for the quota to reset and try again.',
        code: 'llm_quota_exceeded',
      });
      return;
    }

    res.status(502).json({
      error: 'Could not get a response from Gemini. Check GEMINI_API_KEY, GEMINI_MODEL, and your connection.',
    });
  } finally {
    activeSessions.delete(sessionId);
  }
}
