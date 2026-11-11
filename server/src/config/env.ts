import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Locate server/.env from this file, regardless of the terminal's folder.
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));

dotenv.config({ path: envPath, quiet: true });
