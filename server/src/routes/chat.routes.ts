import { Router } from 'express';
import { createSession, handleChat } from '../controllers/chat.controller.js';
import { requireSession } from '../middleware/session.middleware.js';

const chatRouter = Router();

chatRouter.post('/sessions', createSession);
chatRouter.post('/', requireSession, handleChat);

export default chatRouter;
