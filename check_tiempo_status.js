const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  password: 'phoenix123',
  host: 'localhost',
  port: 5432,
  database: 'apoyos_db'
});

async function checkTable() {
  try {
    console.log('📋 Verificando estructura de tiempo_diseno...\n');
    
    const result = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'tiempo_diseno'
      ORDER BY ordinal_position
    `);
    
    console.log('Columnas encontradas:');
    result.rows.forEach((row, i) => {
      console.log(`${i+1}. ${row.column_name} (${row.data_type})${row.column_default ? ` - Default: ${row.column_default}` : ''}`);
    });

    console.log('\n📊 Verificando último registro...\n');
    const latest = await pool.query(`
      SELECT id, username, numero_parte, hora_inicio, hora_fin, 
             tiempo_pausa, tiempo_comida, tiempo_5s, tiempo_meeting, tiempo_pendiente, tiempo_aprobado
      FROM tiempo_diseno 
      ORDER BY id DESC 
      LIMIT 1
    `);

    if (latest.rows.length > 0) {
      const record = latest.rows[0];
      console.log('Registro más reciente (ID ' + record.id + '):');
      console.log('  - usuario:', record.username);
      console.log('  - numero_parte:', record.numero_parte);
      console.log('  - tiempo_pausa:', record.tiempo_pausa);
      console.log('  - tiempo_comida:', record.tiempo_comida);
      console.log('  - tiempo_5s:', record.tiempo_5s);
      console.log('  - tiempo_meeting:', record.tiempo_meeting);
      console.log('  - tiempo_pendiente:', record.tiempo_pendiente);
      console.log('  - tiempo_aprobado:', record.tiempo_aprobado);
    }

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
  }
}

checkTable();
