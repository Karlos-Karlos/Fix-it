const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Log but do not crash — the pool will attempt to recover lost connections
  console.error('Unexpected pool error (non-fatal):', err.message);
});

/** Run a parameterised query */
async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

/** Get a client for transactions */
async function getClient() {
  const client = await pool.connect();
  return client;
}

module.exports = { pool, query, getClient };
