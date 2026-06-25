import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes/api.js';
import { ensureSchema } from './db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.resolve(__dirname, '../../web/dist');
const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 4000;

ensureSchema();

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use('/api', apiRouter);

app.use(express.static(webDistPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  res.sendFile(path.join(webDistPath, 'index.html'), (error) => {
    if (error) {
      res.status(404).send('Build the frontend with `npm run build` in the workspace root.');
    }
  });
});

app.listen(PORT, () => {
  console.log(`ReelSort server listening on http://localhost:${PORT}`);
});
