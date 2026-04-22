const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'apoyos_db',
  password: 'phoenix123',
  port: 5432
});

async function checkTable() {
  try {
    // Verificar si la tabla ordenes existe
    const checkResult = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'ordenes'
      ) as table_exists
    `);
    
    const tableExists = checkResult.rows[0].table_exists;
    console.log('Tabla ordenes existe:', tableExists);
    
    if (!tableExists) {
      console.log('Creando tabla ordenes...');
      
      // Crear la tabla ordenes
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ordenes (
          id SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL,
          order_number VARCHAR(100) NOT NULL UNIQUE,
          client VARCHAR(255),
          customer_job VARCHAR(100),
          project_name VARCHAR(255),
          status VARCHAR(50) DEFAULT 'activo',
          time_worked BIGINT DEFAULT 0,
          price_usd DECIMAL(10, 2) DEFAULT 0.00,
          price_mxn DECIMAL(10, 2) DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES proyectos(id) ON DELETE CASCADE
        )
      `);
      
      // Crear índices
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ordenes_project_id ON ordenes(project_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ordenes_order_number ON ordenes(order_number)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ordenes_status ON ordenes(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ordenes_created_at ON ordenes(created_at DESC)`);
      
      console.log('Tabla ordenes creada exitosamente');
    } else {
      console.log('Tabla ordenes ya existe');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkTable();
