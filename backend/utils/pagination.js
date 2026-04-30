const db = require('../database/db');

/**
 * Execute a paginated query.
 * @param {string} baseQuery  – SELECT ... FROM ... WHERE ... (no LIMIT/OFFSET)
 * @param {string} countQuery – SELECT COUNT(*) ... matching the same WHERE
 * @param {Array}  params     – bind params for the baseQuery (without limit/offset)
 * @param {object} opts       – { page, limit } from query string
 * @returns {{ data, pagination }}
 */
async function paginate(baseQuery, countQuery, params = [], { page = 1, limit = 20 } = {}) {
  page = Math.min(10000, Math.max(1, parseInt(page, 10) || 1));
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (page - 1) * limit;

  const countResult = await db.query(countQuery, params);
  const total = parseInt(countResult.rows[0].count, 10);

  const dataResult = await db.query(
    `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    data: dataResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

module.exports = { paginate };
