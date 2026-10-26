import { migrate, pool } from '../lib/db';
try { await migrate(); console.log('Schema PostgreSQL + pgvector pronto.'); }
finally { await pool.end(); }
