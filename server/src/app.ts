import express from 'express';
import type { ErrorRequestHandler } from 'express';
import cors from 'cors';
import chatRouter from './routes/chat.routes.js';

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));

app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/chat', chatRouter);

const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request body must contain valid JSON.' });
    return;
  }

  if (error.type === 'entity.too.large') {
    res.status(413).json({ error: 'The request body is too large.' });
    return;
  }

  res.status(500).json({ error: 'An unexpected server error occurred.' });
};

app.use(handleError);

export default app;