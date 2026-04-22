# Restauración de Sesión Activa - Documentación

## Descripción del Problema
Cuando un usuario cierra la computadora sin cerrar su sesión en el módulo de Diseño y vuelve a iniciar, necesitaba cargar automáticamente su sesión activa anterior si existe en la base de datos.

## Solución Implementada

### 1. Backend - Endpoint para Verificar Sesión Activa
**Archivo:** `server.js` (línea ~3915)

Se agregó un nuevo endpoint GET `/api/diseno/active-session/:username` que:
- Recibe el nombre de usuario como parámetro
- Busca la sesión más reciente sin `hora_fin` (sesión activa) en la tabla `tiempo_diseno`
- Retorna todos los datos de la sesión activa incluyendo:
  - `id` - ID del registro
  - `numero_parte` - Número de parte en el que estaba trabajando
  - `orden` - Número de orden
  - `hora_inicio` - Hora de inicio de la sesión
  - `tiempo_pausa`, `tiempo_comida`, `tiempo_5s`, `tiempo_meeting`, `tiempo_pendiente`, `tiempo_aprobado` - Tiempos registrados por estado

**Respuesta exitosa:**
```json
{
  "success": true,
  "hasActiveSession": true,
  "session": {
    "id": 123,
    "username": "user123",
    "numero_parte": "PN-12345",
    "orden": "ORD-001",
    "hora_inicio": "2026-01-20T14:30:00Z",
    ...otros campos...
  }
}
```

**Respuesta cuando no hay sesión activa:**
```json
{
  "success": true,
  "hasActiveSession": false,
  "session": null
}
```

### 2. Frontend - Carga Automática de Sesión
**Archivo:** `frontend/logeo-diseno.html`

Se agregaron dos nuevas funciones:

#### a) `loadActiveSession()`
Esta función:
1. Obtiene el nombre de usuario del localStorage
2. Llama al endpoint `/api/diseno/active-session/:username`
3. Si existe una sesión activa:
   - Restaura la interfaz UI (muestra timer card, oculta botones)
   - Calcula el tiempo transcurrido desde `hora_inicio`
   - Restaura los tiempos de los estados (pausa, comida, 5s, meeting, etc.)
   - Inicia el temporizador para continuar desde donde se quedó
   - Muestra un toast de confirmación

#### b) `parseTimeStringToMs(timeString)`
Función auxiliar que convierte tiempos en formato INTERVAL de PostgreSQL (HH:MM:SS) a milisegundos para los cálculos en JavaScript.

#### c) Modificación del `DOMContentLoaded`
El evento `DOMContentLoaded` ahora:
1. Llama primero a `loadActiveSession()` de forma asíncrona
2. Luego inicializa los listeners del botón de login

### 3. Flujo de Funcionamiento

**Escenario: Usuario cierra la computadora sin cerrar sesión**

1. Usuario A está logeado en la orden "ORD-001" desde las 14:30
2. Sin querer, cierra la computadora (o la sesión se pierde por otra razón)
3. La sesión sigue activa en la BD (hora_fin = NULL)
4. Usuario A vuelve a iniciar y accede a logeo-diseno.html
5. Al cargar la página:
   - Se ejecuta `loadActiveSession()`
   - Se busca en la BD si hay sesión activa para Usuario A
   - Se encuentra la sesión de "ORD-001"
   - Se restaura toda la interfaz con el estado anterior
   - El timer continúa desde donde se quedó (considerando el tiempo real transcurrido)
   - Los tiempos de estados se restauran

**Ejemplo de Tiempos Restaurados:**
- Si el usuario había acumulado 10 minutos en estado "Pausa"
- Al restaurar la sesión, ese tiempo se carga en la UI
- Si continúa en pausa, se suma al tiempo anterior

## Cambios Realizados

### Backend (server.js)
```javascript
// Nuevo endpoint (línea ~3915)
app.get('/api/diseno/active-session/:username', async (req, res) => {
  // Lógica de búsqueda de sesión activa
  // Retorna la sesión si existe
});
```

### Frontend (logeo-diseno.html)
```javascript
// Nuevas funciones agregadas:
- loadActiveSession() // Carga la sesión activa
- parseTimeStringToMs() // Convierte INTERVAL a ms

// Modificación:
- DOMContentLoaded ahora llama await loadActiveSession() primero
```

## Ventajas de esta Implementación

1. **Transparente para el usuario**: Se restaura automáticamente sin intervención
2. **Mantiene continuidad**: El timer continúa desde el tiempo real transcurrido
3. **Preserva datos**: Se restauran todos los tiempos de estados acumulados
4. **Seguro**: Solo funciona si hay un usuario logeado en localStorage
5. **Flexible**: Identifica automáticamente la sesión más reciente

## Cómo Probar

1. Iniciar sesión en logeo-diseno.html
2. Logearse en una orden/parte (esto crea registro en BD con hora_fin = NULL)
3. Cerrar la pestaña del navegador
4. Volver a abrir logeo-diseno.html
5. Debería aparecer un toast diciendo "Sesión restaurada para: [NÚMERO]"
6. El timer card debería estar visible con el tiempo transcurrido actualizado

## Script de Prueba

Se incluye `test_active_session.js` para probar el endpoint manualmente:
```bash
node test_active_session.js
```

## Notas Técnicas

- La sesión se busca por `username` y filtra por `hora_fin IS NULL`
- Se ordena por `hora_inicio DESC` para obtener la más reciente
- El cálculo del tiempo transcurrido usa la diferencia: `Date.now() - new Date(hora_inicio)`
- Los tiempos de estado se convierten correctamente del formato INTERVAL de PostgreSQL
- Si hay múltiples sesiones activas (no debería pasar), carga la más reciente
