// ==================== FUNCIONES PARA INTEGRAR CON LA BASE DE DATOS ====================

// Funciones para sincronizar tareas con la BD

// Cargar tareas desde la BD
async function loadTasksFromDB() {
  try {
    const response = await fetch('/api/tareas-personales', {
      credentials: 'include'
    });
    if (response.status === 401) {
      console.warn('Sesión no válida al cargar tareas; usando almacenamiento local');
      loadTasks();
      return;
    }
    if (!response.ok) throw new Error('Error al cargar tareas');

    const tasksDB = await response.json();
    
    // Convertir formato de BD a formato del frontend
    tasks = tasksDB.map(task => ({
      id: task.id,
      title: task.titulo,
      description: task.descripcion,
      priority: task.prioridad,
      status: task.estado,
      createdAt: task.creada_en,
      updatedAt: task.actualizada_en,
      existsInDB: true,
      sharedWith: (task.shared_with || []).map(u => ({
        id: u.id,
        nombre: u.nombre_completo || u.nombre || u.name
      })),
      comments: [] // Los comentarios se cargarán cuando se abre la tarea
    }));

    renderTasks();
  } catch (error) {
    console.error('Error al cargar tareas desde BD:', error);
    // Fallback a localStorage
    loadTasks();
  }
}

// Guardar tarea en la BD
async function saveTaskToDB(task, { forceCreate = false } = {}) {
  // Crear función interna para evitar duplicar el POST
  async function createTask() {
    const response = await fetch('/api/tareas-personales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id: task.id,
        titulo: task.title,
        descripcion: task.description,
        prioridad: task.priority,
        estado: task.status
      })
    });

    if (response.status === 401) {
      console.warn('Sesión no válida al crear tarea; guardando solo localmente');
      task.existsInDB = false;
      return null;
    }
    if (!response.ok) throw new Error('Error al crear tarea');
    const created = await response.json();
    task.existsInDB = true;
    return created;
  }

  try {
    const shouldUpdate = !forceCreate && task.existsInDB === true;

    // Si la tarea ya existe en BD, actualizar
    if (shouldUpdate) {
      const response = await fetch(`/api/tareas-personales/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          titulo: task.title,
          descripcion: task.description,
          prioridad: task.priority,
          estado: task.status
        })
      });

      if (response.status === 401) {
        console.warn('Sesión no válida al actualizar tarea; guardando solo localmente');
        task.existsInDB = false;
        return null;
      }
      if (response.ok) {
        task.existsInDB = true;
        return await response.json();
      }

      // Si la actualización falla por no existir/permisos, intenta crearla
      if (response.status === 403 || response.status === 404) {
        return await createTask();
      }

      throw new Error('Error al actualizar tarea');
    }

    // Crear nueva tarea en BD
    return await createTask();
  } catch (error) {
    console.error('Error al guardar tarea:', error);
    throw error;
  }
}

// Eliminar tarea de la BD
async function deleteTaskFromDB(taskId) {
  try {
    const response = await fetch(`/api/tareas-personales/${taskId}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    if (!response.ok) throw new Error('Error al eliminar tarea');
    return await response.json();
  } catch (error) {
    console.error('Error al eliminar tarea:', error);
    throw error;
  }
}

// Actualizar estado de la tarea en la BD (para drag and drop)
async function updateTaskStatusDB(taskId, newStatus) {
  try {
    const response = await fetch(`/api/tareas-personales/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ estado: newStatus })
    });

    if (!response.ok) throw new Error('Error al actualizar estado');
    return await response.json();
  } catch (error) {
    console.error('Error al actualizar estado:', error);
    throw error;
  }
}

// ==================== FUNCIONES PARA COMENTARIOS ====================

// Cargar comentarios desde la BD
async function loadCommentsFromDB(taskId) {
  try {
    const response = await fetch(`/api/tareas-personales/${taskId}/comentarios`, {
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Error al cargar comentarios');

    const comments = await response.json();
    const normalized = comments.map(c => ({
      id: c.id,
      author: c.author || c.nombre_completo || 'Anónimo',
      text: c.contenido || c.text || '',
      timestamp: c.timestamp || c.creado_en
    }));
    
    // Actualizar el array de comentarios de la tarea
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
      tasks[taskIndex].comments = normalized;
    }

    return normalized;
  } catch (error) {
    console.error('Error al cargar comentarios:', error);
    return [];
  }
}

// Guardar comentario en la BD
async function saveCommentToDB(taskId, commentId, text) {
  try {
    const response = await fetch(`/api/tareas-personales/${taskId}/comentarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id: commentId,
        contenido: text
      })
    });

    if (!response.ok) throw new Error('Error al guardar comentario');
    return await response.json();
  } catch (error) {
    console.error('Error al guardar comentario:', error);
    throw error;
  }
}

// Eliminar comentario de la BD
async function deleteCommentFromDB(commentId) {
  try {
    const response = await fetch(`/api/comentarios/${commentId}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    if (!response.ok) throw new Error('Error al eliminar comentario');
    return await response.json();
  } catch (error) {
    console.error('Error al eliminar comentario:', error);
    throw error;
  }
}

// ==================== FUNCIONES PARA COMPARTIR ====================

// Compartir tarea con usuarios en la BD
async function shareTaskToDB(taskId, userIds) {
  try {
    const response = await fetch(`/api/tareas-personales/${taskId}/compartir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userIds })
    });

    if (!response.ok) throw new Error('Error al compartir tarea');
    return await response.json();
  } catch (error) {
    console.error('Error al compartir tarea:', error);
    throw error;
  }
}

// Cargar usuarios con los que se comparte la tarea
async function loadSharedUsersFromDB(taskId) {
  try {
    const response = await fetch(`/api/tareas-personales/${taskId}/compartidas-con`, {
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Error al cargar usuarios compartidos');

    return await response.json();
  } catch (error) {
    console.error('Error al cargar usuarios compartidos:', error);
    return [];
  }
}
