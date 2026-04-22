# Sistema de Anuncios - Documentación

## Descripción General

Se ha implementado un sistema completo de anuncios que muestra automáticamente imágenes/banners cuando los usuarios abren el selector principal del sistema.

## Características

### 1. Modal de Anuncio en Selector
- **Ubicación**: `frontend/selector.html`
- **Comportamiento**: Se muestra automáticamente al cargar la página
- **Diseño**: 
  - Proporción 16:9 (1920x1080) para imágenes Full HD
  - Fondo oscuro con blur para enfocar la atención
  - Botón de cierre con animación de rotación
  - Responsive para móviles

### 2. Panel de Administración
- **Ubicación**: `frontend/anuncios.html`
- **Funcionalidades**:
  - Subir nuevos anuncios con imagen
  - Vista previa de imagen antes de subir
  - Configurar título (opcional)
  - Establecer fechas de inicio y fin (opcional)
  - Definir prioridad (orden)
  - Listar todos los anuncios existentes
  - Activar/desactivar anuncios
  - Eliminar anuncios

## API Endpoints

### GET `/api/anuncio/actual`
Obtiene el anuncio activo con mayor prioridad para mostrar en el selector.

**Respuesta:**
```json
{
  "id": 1,
  "titulo": "Promoción Navideña",
  "imagen_url": "/uploads/anuncio_123456.jpg",
  "fecha_inicio": "2025-12-01T00:00:00.000Z",
  "fecha_fin": "2025-12-31T23:59:59.000Z"
}
```

### GET `/api/anuncios`
Obtiene todos los anuncios registrados (para administración).

### POST `/api/anuncios`
Crea un nuevo anuncio.

**Body (FormData):**
- `imagen`: archivo de imagen (required)
- `titulo`: título del anuncio (opcional)
- `fecha_inicio`: fecha desde la cual es válido (opcional)
- `fecha_fin`: fecha hasta la cual es válido (opcional)
- `orden`: prioridad (menor = mayor prioridad, default: 0)

### PUT `/api/anuncios/:id`
Actualiza un anuncio existente (para activar/desactivar principalmente).

**Body (JSON):**
```json
{
  "activo": true/false,
  "titulo": "Nuevo título",
  "orden": 1
}
```

### DELETE `/api/anuncios/:id`
Elimina un anuncio y su imagen asociada.

## Base de Datos

### Tabla: `anuncios`
```sql
CREATE TABLE anuncios (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255),
    imagen_url VARCHAR(500) NOT NULL,
    activo BOOLEAN DEFAULT true,
    fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_fin TIMESTAMP,
    creado_por VARCHAR(100),
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    orden INTEGER DEFAULT 0
);
```

**Índices:**
- `idx_anuncios_activo` - Optimiza búsqueda de anuncios activos
- `idx_anuncios_fecha_inicio` - Optimiza filtrado por fechas
- `idx_anuncios_orden` - Optimiza ordenamiento por prioridad

## Flujo de Funcionamiento

1. **Usuario abre selector.html**
   - Se ejecuta `cargarAnuncio()` automáticamente
   - Llama a `/api/anuncio/actual`
   - Si hay anuncio activo, se muestra en el modal
   - Usuario puede cerrar el modal haciendo clic en la X

2. **Administrador sube anuncio**
   - Accede a `anuncios.html`
   - Selecciona imagen (se muestra vista previa)
   - Opcionalmente configura título, fechas y prioridad
   - Hace clic en "Subir Anuncio"
   - El sistema guarda la imagen en `/uploads/` y crea el registro

3. **Lógica de Selección de Anuncio**
   - Solo anuncios con `activo = true`
   - Solo si `fecha_inicio <= NOW()` (o null)
   - Solo si `fecha_fin >= NOW()` (o null)
   - Ordenado por `orden ASC` (menor primero), luego por `fecha_creacion DESC`
   - Se toma el primer resultado

## Archivos Modificados/Creados

### Frontend
- `frontend/selector.html` - Modal de anuncio agregado
- `frontend/styles/nuevo-selector.css` - Estilos del modal
- `frontend/anuncios.html` - Panel de administración completo

### Backend
- `server.js` - 5 nuevos endpoints para gestión de anuncios
- `database/create_anuncios_table.sql` - Script SQL de creación de tabla
- `create_anuncios_table.js` - Script Node.js para crear tabla (ejecutado)

## Recomendaciones de Uso

1. **Tamaño de Imagen**: Se recomienda 1920x1080 (Full HD) para mejor calidad
2. **Formato**: JPG o PNG (PNG para transparencias)
3. **Peso**: Optimizar imágenes para web (< 500KB recomendado)
4. **Prioridad**: Usar orden 0 para anuncios más importantes
5. **Fechas**: Usar fechas para anuncios temporales (promociones, eventos)

## Ejemplo de Uso

```javascript
// Crear anuncio programáticamente
const formData = new FormData();
formData.append('imagen', imagenFile);
formData.append('titulo', 'Black Friday 2025');
formData.append('fecha_inicio', '2025-11-25');
formData.append('fecha_fin', '2025-11-30');
formData.append('orden', 0);

fetch('/api/anuncios', {
  method: 'POST',
  body: formData
});
```

## Mantenimiento

### Limpiar anuncios vencidos
Se recomienda crear un proceso periódico para desactivar o eliminar anuncios vencidos:

```sql
UPDATE anuncios 
SET activo = false 
WHERE fecha_fin < CURRENT_TIMESTAMP AND activo = true;
```

### Limitar número de anuncios activos
Para evitar saturación, se puede implementar un límite en el frontend o backend.
