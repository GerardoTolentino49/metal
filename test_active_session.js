const http = require('http');
const testUsername = 'test_user'; // Cambiar por un usuario real que tenga una sesión activa

const options = {
  hostname: 'localhost',
  port: 3000,
  path: `/api/diseno/active-session/${testUsername}`,
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try 
    {
      const data = JSON.parse(body);
      console.log(' Respuesta del servidor:\n');
      console.log(JSON.stringify(data, null, 2));
      
      if (data.success) 
        {
        if (data.hasActiveSession) 
          {
          console.log('\nSesión activa encontrada para', testUsername);
          console.log('Detalles:', {
            id: data.session.id,
            numero_parte: data.session.numero_parte,
            orden: data.session.orden,
            hora_inicio: data.session.hora_inicio
          });
        } else {
          console.log('\nNo hay sesión activa para', testUsername);
        }
      } else {
        console.log('\n Error en la respuesta:', data.error);
      }
    } catch (e) {
      console.error(' Error al parsear la respuesta:', e.message);
      console.log('Respuesta raw:', body);
    }
  });
});

req.on('error', (e) => {
  console.error('Error en la solicitud:', e.message);
});

req.end();
