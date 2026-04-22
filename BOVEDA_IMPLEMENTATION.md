# Implementación de Bóveda IT con Base de Datos

## Resumen de Cambios

Se ha modificado el sistema de bóveda para almacenar archivos en la base de datos PostgreSQL en lugar de usar localStorage.

## Estructura de la Base de Datos

### Tabla: `it_boveda`

```sql
CREATE TABLE it_boveda (
    id SERIAL PRIMARY KEY,
    fecha_subida TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    etiqueta TEXT,
    comentarios TEXT,
    en_uso BOOLEAN DEFAULT true,
    ruta CHARACTER VARYING(255)
);
```

**Columnas:**
- `id`: Identificador único del archivo
- `fecha_subida`: Fecha y hora de subida del archivo
- `etiqueta`: Etiqueta opcional para clasificar el archivo
- `comentarios`: Comentarios adicionales sobre el archivo
- `en_uso`: Estado del archivo (activo/inactivo)
- `ruta`: Ruta del archivo en el sistema de archivos

## Nuevas Rutas API

### Subir archivo
```
POST /api/boveda/upload
```
**Parámetros:**
- `file`: Archivo a subir
- `etiqueta`: Etiqueta opcional
- `comentarios`: Comentarios opcionales

### Obtener todos los archivos
```
GET /api/boveda/files
```

### Obtener archivo específico
```
GET /api/boveda/files/:id
```

### Actualizar archivo
```
PUT /api/boveda/files/:id
```
**Parámetros:**
- `etiqueta`: Nueva etiqueta
- `comentarios`: Nuevos comentarios
- `en_uso`: Nuevo estado

### Eliminar archivo
```
DELETE /api/boveda/files/:id
```

## Cambios en el Frontend

### Funcionalidades Modificadas:

1. **Subida de archivos**: Ahora usa FormData para enviar archivos al servidor
2. **Carga de archivos**: Obtiene archivos desde la base de datos en lugar de localStorage
3. **Eliminación**: Elimina archivos tanto de la base de datos como del sistema de archivos
4. **Vista previa**: Muestra archivos desde las rutas del servidor

### Nuevas Características:

- **Etiquetas**: Los archivos pueden tener etiquetas para clasificación
- **Comentarios**: Se pueden agregar comentarios a los archivos
- **Persistencia**: Los archivos se mantienen entre sesiones
- **Escalabilidad**: Soporte para archivos de hasta 50MB

## Configuración del Servidor

### Multer Configurado para:
- **Tamaño máximo**: 50MB por archivo
- **Tipos de archivo**: Cualquier tipo permitido
- **Almacenamiento**: Carpeta `uploads/` con nombres únicos

### Base de Datos:
- **Base de datos**: `apoyos_db`
- **Tabla**: `it_boveda`
- **Índices**: Optimizados para búsquedas por fecha, etiqueta y estado

## Instalación y Configuración

1. **Crear la tabla** (ya ejecutado):
   ```bash
   node create_boveda_table.js
   ```

2. **Reiniciar el servidor**:
   ```bash
   node server.js
   ```

3. **Acceder a la bóveda**:
   - Navegar a `http://localhost:3000/frontend/boveda.html`

## Ventajas de la Nueva Implementación

1. **Persistencia**: Los archivos se mantienen en el servidor
2. **Seguridad**: Validación en el servidor
3. **Escalabilidad**: Soporte para archivos grandes
4. **Organización**: Etiquetas y comentarios para mejor organización
5. **Backup**: Los archivos se pueden respaldar desde la base de datos

## Notas Importantes

- Los archivos se almacenan físicamente en la carpeta `uploads/`
- La base de datos solo almacena metadatos y rutas
- Se recomienda configurar backups regulares de la carpeta `uploads/`
- El sistema es compatible con la estructura existente del proyecto 