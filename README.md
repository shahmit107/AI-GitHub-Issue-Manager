# AI GitHub Issue Manager

## Frontend: React + TypeScript

```powershell
cd client
npm install
npm run dev
```

The frontend still shows the React starter. `npm run build` and `npm run lint` check it.

## Backend: Express + TypeScript + LangChain + Gemini

The backend uses Google's Gemini API. The configured model, `gemini-3.5-flash-lite`,
currently has a free tier with account-specific rate and usage limits.

### 1. Get your free-tier API key

1. Open https://aistudio.google.com/apikey and sign in.
2. Create an API key for a project on the Free tier.
3. Add the key to `server/.env` on your computer. Do not paste it into chat.

```dotenv
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash-lite
PORT=3000
CLIENT_ORIGIN=http://localhost:5173
```

If `.env` is missing, copy `server/.env.example` to `server/.env`.
The backend always loads `server/.env` and Git ignores the file.
A Gemini API key is required for this backend.

Keep the Google project on the Free tier for this setup. The code does not upgrade
billing or fall back to a paid provider. A paid-tier project may incur charges.
Free quotas and regional/account availability can change; check Google AI Studio.

### 2. Start the backend

```powershell
cd "C:\Users\shahm\Desktop\Coding\AI GitHub Issue Manager\server"
npm install
npm run dev
```

Restart after changing `.env` using Ctrl+C, then `npm run dev`.
The backend listens at `http://localhost:3000` on this computer.

### 3. Test in Postman

Every chat request requires an existing `sessionId`. Create a conversation first:

1. Send `POST http://localhost:3000/api/chat/sessions` with no body. It returns
   HTTP 201 and `{ "sessionId": "..." }`.
2. Send `POST http://localhost:3000/api/chat` with Body set to raw JSON and include that ID:

```json
{
  "sessionId": "the-id-returned-when-you-created-the-session",
  "question": "My login button is broken. How do I debug it?"
}
```

The response is `{ "answer": "...", "sessionId": "..." }`. Reuse the same ID for
follow-up questions. The model receives previous user and assistant messages in
order. Successful questions and answers are saved together; failed calls do not
change history.

A missing or malformed session ID returns 400; an unknown or deleted session returns 404.
Overlapping requests for the same session return 409: wait for the current answer
before sending the next question. Different sessions can run independently.

History is stored only in the backend process's memory. Restarting the backend
clears all sessions; create a new session afterward. Multiple backend processes
do not share sessions. The frontend has not yet been connected to this API.

Errors return `{ "error": "..." }`:

- 400: invalid JSON, missing/malformed session ID, missing question, or question longer than 10,000 characters.
- 404: the conversation does not exist; create a session first.
- 409: the session is already processing a question; wait before retrying.
- 413: request body exceeds 32 KB.
- 422: Gemini blocked the prompt or response. Try rephrasing the question.
- 429: Gemini rate or quota limit reached. Wait for the quota to reset.
- 503: missing configuration or Gemini temporarily unavailable.
- 502: unavailable model, provider failure, empty answer, or incomplete answer.

Errors include a stable `code` for generation failures: `response_blocked`, `response_incomplete`, `response_empty`, `model_unavailable`, `provider_unavailable`, or `llm_quota_exceeded`.

`GET /health` checks whether the backend is running, not whether your key works.

### Reusable code

- `src/config/env.ts`: loads `server/.env` from a fixed location.
- `src/config/llm.ts`: configures and reuses LangChain's `ChatGoogle` model.
- `src/prompts/chat.prompt.ts`: a `ChatPromptTemplate` with system instructions and a question variable.
- `src/chains/chat.chain.ts`: reusable `askLLM(question, history = [])` chain and response checks.
- `src/routes/chat.routes.ts`: registers chat endpoints and their controller functions.
- `src/controllers/chat.controller.ts`: creates sessions, validates questions, and saves successful exchanges.
- `src/middleware/session.middleware.ts`: requires an existing session for every chat request.
- `src/stores/conversation.store.ts`: shared in-memory session histories.
- `src/app.ts`: Express routes and middleware.
- `src/index.ts`: starts the backend.

```ts
import { askLLM } from './chains/chat.chain.js';

const answer = await askLLM('Explain this issue.');
```

### LangChain workflow

```text
History + question -> ChatPromptTemplate -> ChatGoogle -> response validation -> StringOutputParser -> answer
```

The prompt holds the system instructions, a history message placeholder, and the `{question}` placeholder.
`ChatGoogle` invokes Gemini through LangChain's recommended Google integration.
A `RunnableLambda` checks finish metadata before the parser extracts text.
`.pipe()` connects the steps and `.invoke({ question, history })` runs the chain.
The model is reused, retries are disabled, and requests have a 30-second deadline.
The existing Gemini key and model setting stay the same. Every chat request requires a session ID and uses its conversation history.

Use LangChain abstractions for future prompts, models, parsers, retrieval, and tools
when those features are needed. Conversation history is available through the
required session ID; retrieval and agents have not been added.
### Checks and production build

From `server/`:

```powershell
npm test
npm run build
npm start
```

Tests mock Gemini and make no real API requests. The build writes to `server/dist/`.

Official documentation:
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/api/generate-content


- https://docs.langchain.com/oss/javascript/integrations/chat/google

