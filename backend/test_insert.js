const { Pool } = require('pg');
const dbConfig = require('./config');

async function insertTestTicket() {
  const pool = new Pool(dbConfig);
  
  try {
    const client = await pool.connect();
    console.log('Conexión exitosa a la base de datos');
    
    // Datos de prueba
    const testTicket = {
      id: Date.now().toString(),
      name: 'Usuario de Prueba',
      email: 'prueba@phoenix.com',
      department: 'IT',
      issue: 'Prueba de inserción en la base de datos',
      anydesk: '123-456-789',
      urgency: 'pending',
      timestamp: new Date()
    };

    // Insertar el ticket
    const result = await client.query(
      `INSERT INTO tickets (id, name, email, department, issue, anydesk, urgency, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        testTicket.id,
        testTicket.name,
        testTicket.email,
        testTicket.department,
        testTicket.issue,
        testTicket.anydesk,
        testTicket.urgency,
        testTicket.timestamp
      ]
    );

    console.log('Ticket insertado exitosamente:', result.rows[0]);

    // Verificar que el ticket se insertó correctamente
    const verifyResult = await client.query(
      'SELECT * FROM tickets WHERE id = $1',
      [testTicket.id]
    );

    console.log('Verificación de inserción:', verifyResult.rows[0]);

    client.release();
  } catch (err) {
    console.error('Error al insertar ticket de prueba:', err);
  } finally {
    await pool.end();
  }
}

insertTestTicket(); 