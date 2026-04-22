const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'phoenix_tickets_mantenimiento',
  password: 'phoenix123',
  port: 5432,
});

pool.query("SELECT id, nombre, area FROM herramientas_mantenimiento", (err, res) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('\n=== TODAS LAS HERRAMIENTAS ===\n');
    res.rows.forEach(h => {
      console.log(`ID: ${h.id}, Nombre: ${h.nombre}, Área: "${h.area}"`);
    });
    
    console.log('\n=== BUSCANDO PISTOLA DE AIRE ===\n');
    const pistola = res.rows.find(h => h.nombre.toLowerCase().includes('pistola'));
    if (pistola) {
      console.log(`Encontrado: ${pistola.nombre}`);
      console.log(`Área guardada: "${pistola.area}"`);
      console.log(`Área en hexadecimal: ${Buffer.from(pistola.area || '').toString('hex')}`);
    } else {
      console.log('No se encontró la pistola');
    }
  }
  pool.end();
});
