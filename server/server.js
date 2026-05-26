import { createApp } from './app.js';
import { createDb } from './database.js';

const port = process.env.PORT || 3001;
const db = createDb(process.env.DB_PATH || undefined);
const app = createApp(db);

app.listen(port, () => {
  console.log(`API SQLite escuchando en http://localhost:${port}`);
});
