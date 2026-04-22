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
    console.log('🧪 Probando la inserción corregida...');
    
    const testResult = await apoyosPool.query(
      `INSERT INTO tiempo_diseno (username, numero_parte, orden, cliente, tipo, estado, estado_orden, hora_inicio)
       VALUES ($1, $2, $3, $4, 'meeting', 'pendiente', 'En Proceso', NOW())
       RETURNING id, hora_inicio`,
      ['gerardo', '123', null, null]
    );
    
    console.log('✅ ¡Inserción exitosa!');
    console.log('Record:', testResult.rows[0]);
    
    // Clean up test data
    await apoyosPool.query('DELETE FROM tiempo_diseno WHERE username = $1 AND numero_parte = $2', ['gerardo', '123']);
    console.log('🧹 Registro de prueba eliminado');
    
    process.exit(0);
  } catch(e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
})();
