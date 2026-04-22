# Implementación de JWT para Logeo de Diseño

## ✅ Cambios Realizados

### Backend (server.js)
1. **Importación de jsonwebtoken**
   - Se agregó `const jwt = require('jsonwebtoken');`
   - Se configuró `JWT_SECRET` desde variable de entorno o valor por defecto

2. **Middleware de Verificación**
   - Se creó función `verifyToken(req, res, next)` para validar JWT
   - Extrae el token del header `Authorization: Bearer <token>`
   - Valida la firma y expiración del token

3. **Endpoint `/api/diseno/login` (POST)**
   - Genera un JWT con los datos del usuario
   - Token válido por 8 horas
   - Devuelve el token junto con los datos de la sesión
   - Console logs detallados para debugging

### Frontend (logeo-diseno.html)
1. **Función `saveLoginToServer(partNumber)`**
   - Recibe el token JWT de la respuesta del servidor
   - Guarda el token en `localStorage.disenoToken`
   - Guarda la fecha de expiración en `localStorage.disenoTokenExpiration`

2. **Función `getValidToken()`**
   - Obtiene el token del localStorage
   - Verifica si el token expiró
   - Limpia el token si está expirado
   - Retorna el token válido o null

3. **Función `fetchWithToken(url, options)`**
   - Wrapper para fetch que automáticamente agrega el JWT
   - Válida el token antes de enviar
   - Agrega header `Authorization: Bearer <token>`
   - Maneja errores de autenticación

4. **Limpieza de Token**
   - Se agrega event listener al botón de logout
   - Elimina el token al cerrar sesión
   - Verifica token al cargar la página

## 🔐 Flujo de Autenticación

```
1. Usuario inicia sesión en logeo-diseno.html
   ↓
2. Frontend envía partNumber y username a /api/diseno/login
   ↓
3. Backend valida datos y crea registro en BD
   ↓
4. Backend genera JWT firmado
   ↓
5. Frontend recibe JWT y lo guarda en localStorage
   ↓
6. Peticiones posteriores incluyen JWT en header Authorization
   ↓
7. Backend valida JWT con middleware verifyToken()
   ↓
8. Si es válido, procesa la petición; si no, retorna 403
```

## 📝 Datos en el JWT

El JWT contiene:
```json
{
  "username": "nombre_usuario",
  "sessionId": 123,
  "partNumber": "PN-12345",
  "iat": 1705276800,
  "exp": 1705310400
}
```

## ⏱️ Duración del Token
- **Válido por:** 8 horas
- **Expiración automática:** Se verifica en el cliente antes de cada petición

## 🔧 Cómo Usar el Token en Nuevos Endpoints

Para proteger nuevos endpoints con JWT:

```javascript
// Sin validación
app.get('/api/diseno/datos', async (req, res) => {
  // ...
});

// Con validación JWT
app.get('/api/diseno/datos', verifyToken, async (req, res) => {
  const username = req.user.username;  // Datos del JWT
  const sessionId = req.user.sessionId;
  // ...
});
```

## 🛡️ Seguridad

- Token firmado digitalmente (no se puede modificar sin la secret key)
- Expira automáticamente después de 8 horas
- Se valida en cada petición protegida
- Se elimina al cerrar sesión
- Secret key se lee de variable de entorno `JWT_SECRET` en producción

## 📊 Console Logs para Debugging

El sistema genera logs detallados:

**Frontend:**
```
=== INICIANDO GUARDADO EN BD ===
Payload a enviar: {...}
📝 Nombre del proyecto ingresado: PN-12345
💾 Intentando guardar en BD...
🔐 JWT recibido, guardando en localStorage...
✅ Token JWT guardado correctamente
✅ Guardado exitoso en BD
```

**Backend:**
```
========== NUEVO LOGEO DE DISEÑO ==========
📥 Datos recibidos en el servidor: {...}
💾 Insertando en tabla tiempo_diseno...
✅ Inserción exitosa:
🔐 JWT generado exitosamente
```

## ⚠️ Importante para Producción

Cambiar la `JWT_SECRET` en el archivo `.env`:
```
JWT_SECRET=tu-clave-muy-segura-de-al-menos-32-caracteres
```

**NUNCA** usar la clave por defecto en producción.

## 🚀 Próximas Mejoras (Opcionales)

1. Refresh tokens (para renovar sesiones sin re-autenticar)
2. Blacklist de tokens (para logout inmediato)
3. Rate limiting en el endpoint de login
4. Logs de auditoría (quién inició/cerró sesión y cuándo)
