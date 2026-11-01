import { createApp } from './app.ts';
import { loadEnv } from './env.ts';

const { PORT } = loadEnv();

createApp().listen(PORT, (error) => {
  if (error) throw error;
  console.log(`API listening on http://localhost:${PORT}`);
});
