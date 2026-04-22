# Integración del Calendario con la BD - Guía de Instalación

## Archivos Creados

1. **frontend/js/calendario_db.js** - Funciones para comunicarse con los endpoints
2. **backend/endpoints_calendario.js** - Rutas del API REST para el calendario

## Pasos para Integrar en tu Servidor Express

En tu archivo principal del servidor (donde defines `app.use()`), agrega:

```javascript
const calendarRoutes = require('./endpoints_calendario');

// Después de otras rutas
app.use('/api/calendario', calendarRoutes);
```

## Endpoints Disponibles

### GET /api/calendario/eventos
Carga todos los eventos del usuario autenticado.

**Requiere:** Sesión autenticada
**Retorna:** Array de eventos con estructura:
```json
{
  "id": "string",
  "titulo": "string",
  "descripcion": "string",
  "fecha": "DATE",
  "mes": "YYYY-MM",
  "completado": boolean,
  "creado_en": "TIMESTAMP",
  "actualizado_en": "TIMESTAMP",
  "compartidos": [{id, nombre_completo}]
}
```

### POST /api/calendario/eventos
Crea un nuevo evento.

**Body:**
```json
{
  "id": "string",
  "titulo": "string",
  "descripcion": "string (opcional)",
  "fecha": "YYYY-MM-DD",
  "mes": "YYYY-MM",
  "completado": boolean
}
```

### PATCH /api/calendario/eventos/:eventId
Actualiza el estado de completado de un evento.

**Body:**
```json
{
  "completado": boolean
}
```

### DELETE /api/calendario/eventos/:eventId
Elimina un evento.

### POST /api/calendario/eventos/:eventId/share
Comparte un evento con otros usuarios.

**Body:**
```json
{
  "usuario_ids": [1, 2, 3]
}
```

### GET /api/calendario/eventos/:eventId/compartidos
Obtiene la lista de usuarios con los que se compartió un evento.

## Verificación

Asegúrate de que:
1. ✅ La tabla `calendario_eventos` fue creada
2. ✅ La tabla `calendario_eventos_compartidos` fue creada
3. ✅ El middleware de autenticación está funcionando
4. ✅ Las rutas están registradas en el servidor
5. ✅ El servidor está sirviendo en `localhost:3000` o el puerto configurado

## Notas

- Todos los eventos se asocian automáticamente al `usuario_creador_id` de la sesión
- Los eventos compartidos se almacenan en la tabla `calendario_eventos_compartidos`
- El archivo `frontend/js/calendario_db.js` contiene las funciones que se comunican con estos endpoints
