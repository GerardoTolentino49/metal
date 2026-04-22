const http = require('http');

console.log('🔵 Test: Obtener sesiones del usuario\n');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/diseno/sessions/testuser',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('✅ Response:', res.statusCode);
    try {
      const result = JSON.parse(body);
      console.log('   Success:', result.success);
      console.log('   Sesiones encontradas:', result.sessions?.length || 0);
      
      if (result.sessions && result.sessions.length > 0) {
        console.log('\n📊 Primeras 3 sesiones:');
        result.sessions.slice(0, 3).forEach((s, i) => {
          console.log(`\n   ${i+1}. ${s.numero_parte || 'Sin número'}`);
          console.log(`      Inicio: ${s.hora_inicio}`);
          console.log(`      Fin: ${s.hora_fin || 'No finalizado'}`);
          console.log(`      Tiempo total: ${s.tiempo_total || 'N/A'}`);
          console.log(`      Pausa: ${s.tiempo_pausa}, Comida: ${s.tiempo_comida}`);
        });
      }
    } catch (e) {
      console.log('Error parsing response:', e.message);
      console.log('Body:', body);
    }
  });
});

req.on('error', console.error);
req.end();
