import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';

export const chatPrompt = ChatPromptTemplate.fromMessages([
  ['system', 'You are a helpful assistant for a GitHub issue manager. Answer clearly and concisely.'],
  new MessagesPlaceholder('history'),
  ['human', '{question}'],
]);
