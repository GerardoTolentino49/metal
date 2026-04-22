// Test para verificar que los tiempos se guardan correctamente
const http = require('http');

// Datos de prueba
const loginData = JSON.stringify({
  partNumber: 'TEST-5000',
  username: 'testuser'
});

const finishData = JSON.stringify({
  id: 1,
  tiempos: {
    pausa: 300000,      // 5 minutos
    comida: 1800000,    // 30 minutos
    '5s': 600000,       // 10 minutos
    meeting: 900000,    // 15 minutos
    pendiente: 120000,  // 2 minutos
    aprobado: 180000    // 3 minutos
  }
});

// Paso 1: Login
const loginOptions = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/diseno/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': loginData.length
  }
};

const loginReq = http.request(loginOptions, (loginRes) => {
  let body = '';
  loginRes.on('data', chunk => body += chunk);
  loginRes.on('end', () => {
    console.log('Login Response:', loginRes.statusCode);
    try {
      const result = JSON.parse(body);
      console.log('   ID generado:', result.id);
      console.log('   Success:', result.success);

      if (result.success && result.id) {
        // Paso 2: Finish con los tiempos
        const finishDataWithId = JSON.stringify({
          id: result.id,
          tiempos: {
            pausa: 300000,      // 5 minutos
            comida: 1800000,    // 30 minutos
            '5s': 600000,       // 10 minutos
            meeting: 900000,    // 15 minutos
            pendiente: 120000,  // 2 minutos
            aprobado: 180000    // 3 minutos
          }
        });

        const finishOptions = {
          hostname: 'localhost',
          port: 3000,
          path: '/api/diseno/finish',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': finishDataWithId.length
          }
        };

        console.log(JSON.parse(finishDataWithId));

        const finishReq = http.request(finishOptions, (finishRes) => {
          let finishBody = '';
          finishRes.on('data', chunk => finishBody += chunk);
          finishRes.on('end', () => {
            console.log('\nFinish Response:', finishRes.statusCode);
            try {
              const finishResult = JSON.parse(finishBody);
              console.log('   Success:', finishResult.success);
              if (finishResult.record) {
                console.log('\nTiempos guardados en BD:');
                console.log('   - tiempo_pausa:', finishResult.record.tiempo_pausa);
                console.log('   - tiempo_comida:', finishResult.record.tiempo_comida);
                console.log('   - tiempo_5s:', finishResult.record.tiempo_5s);
                console.log('   - tiempo_meeting:', finishResult.record.tiempo_meeting);
                console.log('   - tiempo_pendiente:', finishResult.record.tiempo_pendiente);
                console.log('   - tiempo_aprobado:', finishResult.record.tiempo_aprobado);
              }
            } catch (e) {
              console.log('Error parsing finish response:', e.message);
            }
          });
        });

        finishReq.on('error', console.error);
        finishReq.write(finishDataWithId);
        finishReq.end();
      }
    } catch (e) {
      console.log('Error parsing login response:', e.message);
    }
  });
});

loginReq.on('error', console.error);
loginReq.write(loginData);
loginReq.end();
