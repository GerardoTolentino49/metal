// Funciones para CRUD de eventos del calendario en la BD

// Cargar todos los eventos del usuario actual
async function loadCalendarEventsFromDB() {
  try {
    const response = await fetch('/api/calendario/eventos');
    if (!response.ok) throw new Error('Error al cargar eventos');
    
    const events = await response.json();
    return events || [];
  } catch (error) {
    console.error('Error cargando eventos del calendario:', error);
    return [];
  }
}

// Guardar un nuevo evento
async function saveCalendarEventToDB(eventData) {
  try {
    const response = await fetch('/api/calendario/eventos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: eventData.title,
        descripcion: eventData.description,
        fecha_evento: eventData.date
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Error al guardar evento');
    }
    
    const saved = await response.json();
    return saved;
  } catch (error) {
    console.error('Error guardando evento:', error);
    throw error;
  }
}

// Actualizar estado de completado
async function updateCalendarEventToDB(eventId, done) {
  try {
    const response = await fetch(`/api/calendario/eventos/${eventId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completado: done })
    });

    if (!response.ok) throw new Error('Error al actualizar evento');
    
    return await response.json();
  } catch (error) {
    console.error('Error actualizando evento:', error);
    throw error;
  }
}

// Eliminar evento
async function deleteCalendarEventFromDB(eventId) {
  try {
    const response = await fetch(`/api/calendario/eventos/${eventId}`, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error('Error al eliminar evento');
    
    return await response.json();
  } catch (error) {
    console.error('Error eliminando evento:', error);
    throw error;
  }
}

// Compartir evento con usuarios
async function shareCalendarEventToDB(eventId, userIds) {
  try {
    const response = await fetch(`/api/calendario/eventos/${eventId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_ids: userIds })
    });

    if (!response.ok) throw new Error('Error al compartir evento');
    
    return await response.json();
  } catch (error) {
    console.error('Error compartiendo evento:', error);
    throw error;
  }
}

// Obtener usuarios con los que está compartido un evento
async function getEventSharedUsers(eventId) {
  try {
    const response = await fetch(`/api/calendario/eventos/${eventId}/compartidos`);
    if (!response.ok) throw new Error('Error al cargar usuarios compartidos');
    
    const users = await response.json();
    return users || [];
  } catch (error) {
    console.error('Error cargando usuarios compartidos:', error);
    return [];
  }
}
