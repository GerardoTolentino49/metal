#!/usr/bin/env node
/**
 * Script para probar el endpoint /api/diseno/login desde el frontend
 */

const username = 'gerardo';
const partNumber = '4123-' + Date.now();

console.log('\n🧪 === TEST DEL ENDPOINT /api/diseno/login ===\n');
console.log('📤 Enviando POST a http://localhost:3000/api/diseno/login');
console.log('Payload:', JSON.stringify({ username, partNumber }, null, 2));

fetch('http://localhost:3000/api/diseno/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, partNumber })
})
  .then(res => {
    console.log('\n📊 Status:', res.status);
    console.log('Headers:', {
      'content-type': res.headers.get('content-type')
    });
    return res.json();
  })
  .then(data => {
    console.log('\n✅ Respuesta recibida:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log('\n🎉 ¡ÉXITO! El registro se guardó correctamente');
      console.log('ID de sesión:', data.session?.id);
      console.log('Token JWT:', data.token ? '✅ Generado' : '❌ No generado');
    } else {
      console.log('\n❌ Error:', data.error);
    }
  })
  .catch(error => {
    console.error('\n❌ Error de conexión:', error.message);
    console.error('¿El servidor está corriendo en http://localhost:3000?');
  });
