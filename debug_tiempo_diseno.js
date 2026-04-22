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
    // Check if table exists
    const tableCheck = await apoyosPool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'tiempo_diseno'
      );
    `);
    
    console.log('🔍 Table existe:', tableCheck.rows[0].exists);
    
    if (tableCheck.rows[0].exists) {
      // Get table structure
      const structure = await apoyosPool.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' 
        ORDER BY ordinal_position
      `);
      
      console.log('\n📋 Estructura de tabla tiempo_diseno:');
      console.table(structure.rows);
      
      // Try to insert test data
      console.log('\n🧪 Intentando insertar registro de prueba...');
      const testResult = await apoyosPool.query(
        `INSERT INTO tiempo_diseno (username, numero_parte, orden, cliente, estado, estado_orden, hora_inicio)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id, hora_inicio`,
        ['test_user', '123', null, null, 'Activo', 'En Proceso']
      );
      
      console.log('✅ Inserción exitosa!');
      console.log('Record:', testResult.rows[0]);
      
      // Clean up test data
      await apoyosPool.query('DELETE FROM tiempo_diseno WHERE username = $1', ['test_user']);
      console.log('🧹 Registro de prueba eliminado');
    } else {
      console.log('❌ La tabla tiempo_diseno NO EXISTE');
      console.log('\n📝 Creando la tabla...');
      
      await apoyosPool.query(`
        CREATE TABLE tiempo_diseno (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            numero_parte VARCHAR(200),
            orden VARCHAR(100),
            cliente VARCHAR(200),
            estado VARCHAR(50) DEFAULT 'Activo',
            estado_orden VARCHAR(50) DEFAULT 'En Proceso',
            hora_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            hora_fin TIMESTAMP,
            tiempo_total INTERVAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      console.log('✅ Tabla creada exitosamente!');
    }
    
    process.exit(0);
  } catch(e) {
    console.error('❌ Error:', e.message);
    console.error('Detalles:', e);
    process.exit(1);
  }
})();
