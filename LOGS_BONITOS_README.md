# 🎨 Logs Bonitos con Pino-Pretty

## ✨ Características Implementadas

### 1. **Logs Coloreados**
- **INFO**: Azul claro (📝)
- **WARN**: Amarillo (⚠️)
- **ERROR**: Rojo (❌)
- **DEBUG**: Magenta (🔍)

### 2. **Emojis Descriptivos**
- 🚀 Inicio del servidor
- 📝 Nuevas solicitudes
- ✅ Operaciones exitosas
- ⚠️ Advertencias
- 💥 Errores
- 📥 Consultas GET
- ✏️ Actualizaciones PUT
- 🗑️ Eliminaciones DELETE
- 🔧 Operaciones PATCH

### 3. **Formato Mejorado**
- Timestamps legibles
- Niveles de log claros
- Sin información innecesaria (pid, hostname)
- Colores para mejor legibilidad

## 🛠️ Instalación

```bash
npm install pino-pretty
```

## 📋 Configuración

La configuración está en `server.js`:

```javascript
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      levelFirst: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});
```

## 🚀 Uso

### Logs Básicos
```javascript
logger.info('📝 Nueva solicitud recibida');
logger.warn('⚠️  Campo requerido faltante');
logger.error('💥 Error de conexión');
```

### Logs de Solicitudes RH
```javascript
// Nueva solicitud
logger.info(`📝 Nueva solicitud RH recibida de: ${nombre}`);

// Solicitud exitosa
logger.info(`✅ Solicitud RH creada exitosamente - ID: ${id} | ${nombre}`);

// Solicitud rechazada
logger.warn(`⚠️  Solicitud RH rechazada - campos obligatorios faltantes para: ${nombre}`);

// Error
logger.error(`💥 Error al crear solicitud RH: ${error.message}`);
```

### Logs de API
```javascript
// Consulta exitosa
logger.info(`📥 Solicitudes RH consultadas - Total: ${count}`);

// Actualización
logger.info(`✏️  Actualizando estado de solicitud RH - ID: ${id} | Nuevo estado: ${estado}`);

// Estado actualizado
logger.info(`✅ Estado de solicitud RH actualizado - ID: ${id} | Estado: ${estado}`);
```

## 🌈 Ejemplos de Salida

### Inicio del Servidor
```
INFO [2025-08-21 12:55:16.286 -0700]: 🚀 Servidor iniciado exitosamente en puerto 3000
INFO [2025-08-21 12:55:16.286 -0700]: 🌐 URL: http://localhost:3000
INFO [2025-08-21 12:55:16.286 -0700]: 📋 API disponible en: http://localhost:3000/api/solicitudes-rh
```

### Solicitudes RH
```
INFO [2025-08-21 12:55:16.289 -0700]: 📝 Nueva solicitud RH recibida de: Juan Pérez
INFO [2025-08-21 12:55:16.289 -0700]: ✅ Solicitud RH creada exitosamente - ID: 6 | Juan Pérez
```

### Errores
```
ERROR [2025-08-21 12:55:16.289 -0700]: 💥 Error al crear solicitud RH: connection timeout
```

### Advertencias
```
WARN [2025-08-21 12:55:16.289 -0700]: ⚠️  Solicitud RH rechazada - campos obligatorios faltantes
```

## 🔧 Variables de Entorno

```bash
# Nivel de log (trace, debug, info, warn, error, fatal)
LOG_LEVEL=info

# Entorno (development, production)
NODE_ENV=development
```

## 📱 Logs HTTP Automáticos

El servidor también registra automáticamente todas las peticiones HTTP con:

- **Método HTTP** (GET, POST, PUT, DELETE)
- **URL** de la petición
- **Código de estado** de respuesta
- **Tiempo de respuesta** en milisegundos
- **Emojis** según el tipo de operación

## 🎯 Beneficios

1. **Legibilidad**: Logs fáciles de leer y entender
2. **Debugging**: Identificación rápida de problemas
3. **Monitoreo**: Seguimiento visual de operaciones
4. **Mantenimiento**: Logs organizados y estructurados
5. **Desarrollo**: Mejor experiencia para desarrolladores

## 🚨 Notas Importantes

- Los logs en producción pueden deshabilitar colores
- El nivel de log se puede ajustar según necesidades
- Los emojis se muestran correctamente en terminales modernas
- Compatible con sistemas de logging centralizados

## 🔄 Reinicio del Servidor

Para aplicar los cambios de configuración:

```bash
# Detener servidor actual
Ctrl + C

# Reiniciar servidor
node server.js
```

¡Disfruta de tus logs bonitos! 🎨✨
