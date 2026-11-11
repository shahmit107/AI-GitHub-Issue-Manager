import './config/env.js';
import app from './app.js';

const port = Number(process.env.PORT || 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a whole number between 1 and 65535.');
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Backend running at http://localhost:${port}`);

  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.log('Add GEMINI_API_KEY to server/.env to enable LLM responses.');
  }
});


