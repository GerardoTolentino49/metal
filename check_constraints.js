const { Pool } = require('pg');

const apoyosPool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'apoyos_db',
    password: 'phoenix123',
    port: 5432,
    ssl: false,
});

(async () => {
  try {
    // Get table constraints
    const constraints = await apoyosPool.query(`
      SELECT t.constraint_name, t.constraint_type, c.check_clause
      FROM information_schema.table_constraints t
      LEFT JOIN information_schema.check_constraints c 
      ON t.constraint_name = c.constraint_name
      WHERE t.table_name = 'tiempo_diseno'
    `);
    
    console.log('📋 Constraints en tiempo_diseno:');
    console.table(constraints.rows);
    
    process.exit(0);
  } catch(e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
})();
