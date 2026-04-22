const pool = require('./config.js');

(async () => {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'tiempo_diseno' 
      ORDER BY ordinal_position
    `);
    console.log('🔍 Estructura de la tabla tiempo_diseno:');
    console.table(result.rows);
    process.exit(0);
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
