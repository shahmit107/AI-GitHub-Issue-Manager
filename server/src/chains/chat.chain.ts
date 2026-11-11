import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableLambda } from '@langchain/core/runnables';
import { getChatModel } from '../config/llm.js';
import { chatPrompt } from '../prompts/chat.prompt.js';

export class LLMResponseError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 502) {
    super(message);
  }
}

function validateResponse(response: AIMessage): AIMessage {
  const finishReason = response.response_metadata.finish_reason;
  const blockedReasons = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'];

  if (typeof finishReason === 'string' && blockedReasons.includes(finishReason)) {
    throw new LLMResponseError(
      'Gemini blocked this response. Try rephrasing your question.',
      'response_blocked',
      422,
    );
  }

  if (finishReason !== 'STOP') {
    throw new LLMResponseError(
      'Gemini could not finish the answer. Try a shorter or more focused question.',
      'response_incomplete',
    );
  }

  return response;
}

export async function askLLM(question: string, history: BaseMessage[] = []): Promise<string> {
  // Each pipe passes its result to the next LangChain step.
  const chain = chatPrompt
    .pipe(getChatModel())
    .pipe(RunnableLambda.from(validateResponse))
    .pipe(new StringOutputParser());

  try {
    const answer = await chain.invoke({ question, history }, { signal: AbortSignal.timeout(30_000) });

    if (!answer.trim()) {
      throw new LLMResponseError('Gemini returned an empty answer. Try again.', 'response_empty');
    }

    return answer.trim();
  } catch (error) {
    if (error instanceof Error && error.name === 'PromptBlockedError') {
      throw new LLMResponseError(
        'Gemini blocked this response. Try rephrasing your question.',
        'response_blocked',
        422,
      );
    }

    if (error instanceof Error && error.name === 'NoCandidatesError') {
      throw new LLMResponseError('Gemini returned an empty answer. Try again.', 'response_empty');
    }

    throw error;
  }
}

