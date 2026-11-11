import './env.js';
import { ChatGoogle } from '@langchain/google/node';

let model: ChatGoogle | undefined;

export function getChatModel(): ChatGoogle {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const modelName = process.env.GEMINI_MODEL?.trim();

  if (!apiKey) {
    throw new Error('Set GEMINI_API_KEY in server/.env first.');
  }

  if (!modelName) {
    throw new Error('Set GEMINI_MODEL in server/.env first.');
  }

  if (!model) {
    model = new ChatGoogle({
      apiKey,
      model: modelName,
      platformType: 'gai',
      maxRetries: 0,
    });
  }

  return model;
}