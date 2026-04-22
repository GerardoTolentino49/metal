# Guía de Instalación - Tareas Personales

## Paso 1: Crear las Tablas en la Base de Datos

Ejecuta el siguiente script SQL en tu base de datos PostgreSQL:

```bash
psql -U usuario -d nombre_base_datos -f database/create_tareas_personales.sql
```

O copia y pega el contenido de `database/create_tareas_personales.sql` en tu herramienta de administración SQL.

## Paso 2: Agregar los Endpoints al Servidor

1. Abre `server.js` en tu editor
2. Ubica la línea donde se definen los endpoints (generalmente cerca del final)
3. Incluye el archivo de endpoints de tareas personales:

```javascript
// Agregar esta línea con los otros require/imports
// require('./backend/endpoints_tareas_personales.js');

// O copia todo el contenido de backend/endpoints_tareas_personales.js directamente en server.js
```

Alternativamente, puedes copiar todo el contenido del archivo `backend/endpoints_tareas_personales.js` directamente en `server.js` antes de que el servidor escuche (`app.listen`).

## Paso 3: Agregar el Script de BD en el Frontend

Abre `frontend/tareas_personales.html` y agrega esta línea en la sección de scripts (después de `js/permisos.js`):

```html
<script src="js/tareas_db.js"></script>
```

## Paso 4: Modificar el Código del Frontend

En `frontend/tareas_personales.html`, dentro del script principal, modifica la sección de inicialización para cargar desde la BD:

### Opción A: Cargar desde BD (Recomendado)
```javascript
// Cambiar:
loadTasks();

// Por:
loadTasksFromDB();
```

### Opción B: Híbrida (localStorage + BD)
Si deseas mantener sincronización con localStorage y BD:

```javascript
// Modificar saveTasks() para:
async function saveTasks() {
  localStorage.setItem('kanbanTasks', JSON.stringify(tasks));
  // También guardar en BD
  for (const task of tasks) {
    try {
      await saveTaskToDB(task);
    } catch (error) {
      console.error('Error sincronizando con BD:', error);
    }
  }
}
```

## Paso 5: Modificar Funciones Clave

### Para Crear Tareas
Modifica la función donde se guarda la tarea para que también la guarde en BD:

```javascript
saveTasks();
// Agregar:
await saveTaskToDB(newTask);
```

### Para Actualizar Estado (Drag & Drop)
En la función `updateTaskStatus`:

```javascript
function updateTaskStatus(taskId, newStatus) {
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex !== -1) {
    tasks[taskIndex].status = newStatus;
    saveTasks();
    // Agregar:
    updateTaskStatusDB(taskId, newStatus).catch(err => {
      console.error('Error actualizando en BD:', err);
    });
    renderTasks();
    setupDragAndDrop();
  }
}
```

### Para Agregar Comentarios
En la función donde se agregan comentarios:

```javascript
// Después de: tasks[taskIndex].comments.push({...})
saveTasks();
// Agregar:
saveCommentToDB(currentCommentTaskId, comment.id, comment.text).catch(err => {
  console.error('Error guardando comentario:', err);
});
```

### Para Compartir Tareas
En la función `confirmShareBtn.addEventListener`:

```javascript
// Después de: tasks[taskIndex].sharedWith = [...selectedUsers];
saveTasks();
// Agregar:
shareTaskToDB(currentSharingTaskId, selectedUsers.map(u => u.id)).catch(err => {
  console.error('Error compartiendo:', err);
});
```

## Estrutura de las Tablas

### tareas_personales
- `id`: VARCHAR(50) - ID único de la tarea
- `usuario_id`: INTEGER - ID del usuario propietario
- `titulo`: VARCHAR(255) - Título de la tarea
- `descripcion`: TEXT - Descripción de la tarea
- `prioridad`: VARCHAR(20) - low, medium, high
- `estado`: VARCHAR(20) - todo, in-progress, done
- `creada_en`: TIMESTAMP - Fecha de creación
- `actualizada_en`: TIMESTAMP - Fecha de última actualización
- `posicion`: INTEGER - Posición en el tablero

### comentarios_tareas
- `id`: VARCHAR(50) - ID único del comentario
- `tarea_id`: VARCHAR(50) - Referencia a la tarea
- `usuario_id`: INTEGER - ID del usuario que comentó
- `contenido`: TEXT - Contenido del comentario
- `creado_en`: TIMESTAMP - Fecha de creación

### tareas_compartidas
- `id`: INTEGER - ID auto-generado
- `tarea_id`: VARCHAR(50) - Referencia a la tarea
- `usuario_propietario_id`: INTEGER - ID del propietario
- `usuario_compartido_id`: INTEGER - ID del usuario con el que se comparte
- `compartida_en`: TIMESTAMP - Fecha de compartición

## Endpoints Disponibles

### Tareas
- `GET /api/tareas-personales` - Obtener todas las tareas del usuario
- `POST /api/tareas-personales` - Crear nueva tarea
- `PUT /api/tareas-personales/:id` - Actualizar tarea
- `DELETE /api/tareas-personales/:id` - Eliminar tarea

### Comentarios
- `GET /api/tareas-personales/:taskId/comentarios` - Obtener comentarios
- `POST /api/tareas-personales/:taskId/comentarios` - Agregar comentario
- `DELETE /api/comentarios/:commentId` - Eliminar comentario

### Compartición
- `POST /api/tareas-personales/:taskId/compartir` - Compartir tarea
- `GET /api/tareas-personales/:taskId/compartidas-con` - Ver usuarios compartidos

## Notas Importantes

1. **Autenticación**: Los endpoints requieren que el usuario esté logueado (`req.session.userId`)
2. **Permisos**: Solo el propietario de una tarea puede modificarla o eliminarla
3. **Performance**: Los comentarios se cargan bajo demanda cuando se abre el modal
4. **Sincronización**: Puedes usar localStorage como caché y BD como fuente de verdad

## Solución de Problemas

### Error: "REFERENCED TABLE DOES NOT EXIST"
- Asegúrate de que la tabla `usuarios` existe
- Verifica que los IDs de usuario son correctos

### Error: "No autorizado"
- Verifica que el usuario está logueado (`req.session.userId`)
- Comprueba que la sesión está funcionando correctamente

### Los datos no se guardan en BD
- Abre la consola del navegador (F12) y revisa los errores
- Verifica que los endpoints estén correctamente definidos en `server.js`
