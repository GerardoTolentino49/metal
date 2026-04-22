const { Pool } = require('pg');
const fs = require('fs');

const apoyosPool = new Pool({
  user: 'postgres',
  password: 'phoenix123',
  host: 'localhost',
  port: 5432,
  database: 'apoyos_db'
});

async function runMigration() {
  try {
    console.log('📊 Ejecutando migración: agregar columnas de status timers...\n');
    
    const sql = fs.readFileSync('./database/add_status_timers_to_tiempo_diseno.sql', 'utf8');
    
    await apoyosPool.query(sql);
    
    console.log('✅ Migración completada exitosamente\n');
    
    // Verificar que las columnas se crearon
    const result = await apoyosPool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tiempo_diseno' 
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Columnas de la tabla tiempo_diseno:\n');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    await apoyosPool.end();
  } catch (error) {
    console.error('❌ Error en migración:', error.message);
    await apoyosPool.end();
    process.exit(1);
  }
}

runMigration();
