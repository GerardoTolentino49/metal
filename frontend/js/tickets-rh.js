// Variables globales
let lastTicketCount = 0;
let draggedTicket = null;

// Función para cargar tickets desde la base de datos
async function loadTickets() {
    try {
        // Cambiar a la API de tickets_rh en lugar de phoenix_tickets_rh
        const response = await fetch('/api/solicitudes-rh');
        if (!response.ok) throw new Error('Error al cargar solicitudes');
        
        const data = await response.json();
        const tickets = data.solicitudes || [];
        
        // Mapear los campos de tickets_rh a la estructura esperada
        const mappedTickets = tickets.map(ticket => ({
            id: ticket.id,
            name: ticket.nombre,
            department: ticket.tipo_documento || 'N/A',
            area: ticket.numero_empleado || 'N/A',
            issue: ticket.peticion,
            urgency: mapEstadoToUrgency(ticket.estado),
            timestamp: ticket.timestamp,
            estado: ticket.estado,
            comentarios: ticket.comentarios,
            fecha_completado: ticket.fecha_completado
        }));
        
        renderTickets(mappedTickets);
        lastTicketCount = mappedTickets.length;
        
        // Actualizar contador de tickets terminados
        updateCompletedCount();
    } catch (error) {
        console.error('Error al cargar solicitudes:', error);
        showNotification('Error al cargar solicitudes', 'error');
    }
}

// Función para mapear el estado de tickets_rh a urgencia del kanban
function mapEstadoToUrgency(estado) {
    switch(estado) {
        case 'pendiente': return 'pending';
        case 'en_proceso': return 'medium';
        case 'completado': return 'completed';
        case 'urgente': return 'high';
        case 'critico': return 'critical';
        default: return 'pending';
    }
}

// Función para mapear urgencia del kanban a estado de tickets_rh
function mapUrgencyToEstado(urgency) {
    switch(urgency) {
        case 'pending': return 'pendiente';
        case 'medium': return 'en_proceso';
        case 'completed': return 'completado';
        case 'high': return 'urgente';
        case 'critical': return 'critico';
        default: return 'pendiente';
    }
}

// Función para renderizar tickets en el kanban
function renderTickets(tickets) {
    // Limpiar contenedores
    document.querySelectorAll('.kanban-column .tickets-container').forEach(container => {
        container.innerHTML = '';
    });
    
    // Agrupar tickets por urgencia
    const ticketsByUrgency = {
        pending: [],
        critical: [],
        high: [],
        medium: [],
        low: []
    };
    
    tickets.forEach(ticket => {
        if (ticketsByUrgency[ticket.urgency]) {
            ticketsByUrgency[ticket.urgency].push(ticket);
        } else {
            ticketsByUrgency['pending'].push(ticket);
        }
    });
    
    // Renderizar tickets en cada columna
    Object.keys(ticketsByUrgency).forEach(urgency => {
        const container = document.querySelector(`[data-status="${urgency}"] .tickets-container`);
        if (container) {
            ticketsByUrgency[urgency].forEach(ticket => {
                const ticketElement = createTicketElement(ticket);
                container.appendChild(ticketElement);
            });
        }
    });
}

// Función para crear elemento de ticket
function createTicketElement(ticket) {
    const div = document.createElement('div');
    div.className = 'ticket';
    div.draggable = true;
    div.dataset.ticketId = ticket.id;
    
    // Calcular tiempo transcurrido
    const ticketTime = new Date(ticket.timestamp);
    const now = new Date();
    const timeDiff = now - ticketTime;
    const hoursDiff = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutesDiff = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    // Determinar color basado en tiempo
    let timeColor = 'green';
    if (hoursDiff >= 4) timeColor = 'red';
    else if (hoursDiff >= 2) timeColor = 'orange';
    else if (hoursDiff >= 1) timeColor = 'yellow';
    
    // Truncar petición para vista previa
    const peticionPreview = ticket.issue.length > 50 ? 
        ticket.issue.substring(0, 50) + '...' : ticket.issue;
    
    div.innerHTML = `
        <div class="ticket-name" title="${ticket.name}">${ticket.name}</div>
        <div class="problem-preview">
            <b>Petición:</b> ${peticionPreview}
        </div>
        <div class="ticket-details">
            <small><b>Doc:</b> ${ticket.department}</small>
            <small><b>Empleado:</b> ${ticket.area}</small>
        </div>
        <div class="time-indicator ${timeColor}">
            <b>Tiempo:</b> ${hoursDiff}h ${minutesDiff}m
        </div>
        <div class="estado-badge ${ticket.estado}">
            ${ticket.estado}
        </div>
        <button class="assign-button" onclick="showTicketDetails(${ticket.id})" title="Ver detalles">
            <i class="fas fa-eye"></i>
        </button>
    `;
    
    // Eventos del ticket
    div.addEventListener('dragstart', handleDragStart);
    div.addEventListener('dragend', handleDragEnd);
    div.addEventListener('dblclick', () => showTicketDetails(ticket));
    
    // Animación de entrada
    animateTicketEntry(div);
    
    return div;
}

// Función para actualizar urgencia del ticket
async function updateTicketUrgency(ticketId, newUrgency) {
    try {
        const newEstado = mapUrgencyToEstado(newUrgency);
        
        const response = await fetch(`/api/solicitudes-rh/${ticketId}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                estado: newEstado,
                comentarios: `Estado cambiado a: ${newEstado}`
            })
        });
        
        if (!response.ok) throw new Error('Error al actualizar estado');
        
        const updatedTicket = await response.json();
        showNotification('Estado actualizado correctamente', 'success');
        return updatedTicket;
    } catch (error) {
        console.error('Error al actualizar estado:', error);
        showNotification('Error al actualizar estado', 'error');
        throw error;
    }
}

// Función para completar ticket
async function completeTicket(ticketId) {
    try {
        const response = await fetch(`/api/solicitudes-rh/${ticketId}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                estado: 'completado',
                comentarios: 'Solicitud completada'
            })
        });
        
        if (!response.ok) throw new Error('Error al completar solicitud');
        
        const completedTicket = await response.json();
        showNotification('Solicitud completada correctamente', 'success');
        
        // Actualizar contador de terminados
        updateCompletedCount();
        
        return completedTicket;
    } catch (error) {
        console.error('Error al completar solicitud:', error);
        showNotification('Error al completar solicitud', 'error');
        throw error;
    }
}

// Función para asignar ticket
async function assignTicket(ticketId, userId, userName) {
    try {
        const response = await fetch(`/api/tickets-rh/${ticketId}/assign`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assigned_user_id: userId })
        });
        
        if (!response.ok) throw new Error('Error al asignar ticket');
        
        const assignedTicket = await response.json();
        showNotification('Ticket asignado correctamente', 'success');
        
        // Recargar tickets para mostrar cambios
        await loadTickets();
        
        return assignedTicket;
    } catch (error) {
        console.error('Error al asignar ticket:', error);
        showNotification('Error al asignar ticket', 'error');
        throw error;
    }
}

// Función para eliminar ticket
async function deleteTicket(ticketId) {
    try {
        const response = await fetch(`/api/tickets-rh/${ticketId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('Error al eliminar ticket');
        
        showNotification('Ticket eliminado correctamente', 'success');
        
        // Recargar tickets
        await loadTickets();
    } catch (error) {
        console.error('Error al eliminar ticket:', error);
        showNotification('Error al eliminar ticket', 'error');
    }
}

// Función para verificar actualizaciones
async function checkForUpdates() {
    try {
        const response = await fetch('/api/tickets-rh/check-updates');
        if (!response.ok) throw new Error('Error al verificar actualizaciones');
        
        const data = await response.json();
        
        if (data.hasNewTickets) {
            showNotification('Nuevos tickets disponibles', 'info');
            await loadTickets();
        }
    } catch (error) {
        console.error('Error al verificar actualizaciones:', error);
    }
}

// Función para mostrar tickets completados
async function showCompletedTickets() {
    try {
        // Obtener todas las solicitudes y filtrar las completadas
        const response = await fetch('/api/solicitudes-rh');
        if (!response.ok) throw new Error('Error al cargar solicitudes');
        
        const data = await response.json();
        const completedTickets = data.solicitudes.filter(ticket => ticket.estado === 'completado');
        
        renderCompletedTickets(completedTickets);
        
        const modal = document.getElementById('completedModal');
        modal.classList.add('active');
    } catch (error) {
        console.error('Error al cargar solicitudes completadas:', error);
        showNotification('Error al cargar solicitudes completadas', 'error');
    }
}

// Función para renderizar tickets completados
function renderCompletedTickets(tickets) {
    const grid = document.getElementById('completedTicketsGrid');
    grid.innerHTML = '';
    
    if (tickets.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #888;">
                <div style="font-size: 48px; margin-bottom: 20px;">📭</div>
                <h3>No hay tickets completados</h3>
                <p>Los tickets completados aparecerán aquí</p>
            </div>
        `;
        return;
    }
    
    tickets.forEach(ticket => {
        const ticketElement = document.createElement('div');
        ticketElement.className = 'completed-ticket';
        
        const completedTime = ticket.fecha_completado ? 
            new Date(ticket.fecha_completado).toLocaleString('es-ES', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
        
        ticketElement.innerHTML = `
            <h4>📄 ${ticket.nombre}</h4>
            <p><strong> Tipo:</strong> ${ticket.tipo_documento || 'N/A'}</p>
            <p><strong> Empleado:</strong> ${ticket.numero_empleado || 'N/A'}</p>
            <p><strong> Petición:</strong> ${ticket.peticion}</p>
            <p><strong>✅ Completado:</strong> ${completedTime}</p>
            <button class="delete-completed-ticket" onclick="deleteCompletedTicket('${ticket.id}')" title="Eliminar ticket">
                🗑️
            </button>
        `;
        
        grid.appendChild(ticketElement);
    });
}

// Función para eliminar ticket completado
async function deleteCompletedTicket(ticketId) {
    try {
        await deleteTicket(ticketId);
        await showCompletedTickets(); // Recargar lista
    } catch (error) {
        console.error('Error al eliminar ticket completado:', error);
    }
}

// Función para actualizar contador de terminados
async function updateCompletedCount() {
    try {
        const response = await fetch('/api/solicitudes-rh');
        if (!response.ok) throw new Error('Error al obtener contador');
        
        const data = await response.json();
        const completedTickets = data.solicitudes.filter(ticket => ticket.estado === 'completado');
        
        const countSpan = document.querySelector('.completed-button .ticket-count');
        if (countSpan) {
            countSpan.textContent = completedTickets.length;
        }
    } catch (error) {
        console.error('Error al actualizar contador:', error);
    }
}

// Funciones de utilidad
function showNotification(message, type = 'info') {
    // Implementar sistema de notificaciones
    console.log(`${type.toUpperCase()}: ${message}`);
}

function animateTicketEntry(element) {
    element.style.opacity = '0';
    element.style.transform = 'translateY(20px)';
    requestAnimationFrame(() => {
        element.style.transition = 'opacity 0.4s, transform 0.4s';
        element.style.opacity = '1';
        element.style.transform = 'translateY(0)';
    });
}

// Event listeners para drag and drop
function handleDragStart(e) {
    draggedTicket = this;
    this.classList.add('dragging');
    animateCompletedButton(1.2, 200);
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    animateCompletedButton(1, 300);
    draggedTicket = null;
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e) {
    e.preventDefault();
    if (!draggedTicket) return;

    const newStatus = this.dataset.status;
    const ticketId = draggedTicket.dataset.ticketId;

    if (newStatus === 'completed') {
        // Completar ticket
        completeTicket(ticketId).then(() => {
            // Remover del DOM
            if (draggedTicket.parentNode) {
                draggedTicket.parentNode.removeChild(draggedTicket);
            }
        }).catch(() => {
            // Si falla, no hacer nada (el ticket se mantiene en su lugar)
        });
        return;
    }

    // Mover ticket a nueva columna
    const targetContainer = this.querySelector('.tickets-container');
    if (targetContainer) {
        if (draggedTicket.parentNode) {
            draggedTicket.parentNode.removeChild(draggedTicket);
        }
        targetContainer.appendChild(draggedTicket);
    }

    // Actualizar en BD
    updateTicketUrgency(ticketId, newStatus);
}

// Función para animar botón de terminados
function animateCompletedButton(scale = 1, duration = 300) {
    const completedButton = document.getElementById('completedButton');
    if (completedButton) {
        completedButton.style.transition = `all ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        completedButton.style.transform = `translateX(-50%) scale(${scale})`;
    }
}

// Función para mostrar detalles del ticket con mejor diseño
function showTicketDetails(ticket) {
    const modal = document.getElementById('ticketModal');
    const modalBody = document.getElementById('modalBody');
    
    // Crear contenido con mejor estructura visual
    modalBody.innerHTML = `
        <div class="ticket-details-full">
            <h3>📋 Detalles de la Solicitud</h3>
            
            <div class="detail-row">
                <strong>👤 Nombre</strong>
                <span>${ticket.name}</span>
            </div>
            
            <div class="detail-row">
                <strong>📄 Tipo de Documento</strong>
                <span>${ticket.department || 'N/A'}</span>
            </div>
            
            <div class="detail-row">
                <strong> Número de Empleado</strong>
                <span>${ticket.area || 'N/A'}</span>
            </div>
            
            <div class="detail-row">
                <strong> Petición</strong>
                <span>${ticket.issue}</span>
            </div>
            
            <div class="detail-row">
                <strong>🏷️ Estado</strong>
                <span class="estado-badge ${ticket.estado}">${ticket.estado}</span>
            </div>
            
            <div class="detail-row">
                <strong>📅 Fecha de Creación</strong>
                <span>${new Date(ticket.timestamp).toLocaleString('es-ES', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}</span>
            </div>
            
            ${ticket.comentarios ? `
            <div class="detail-row">
                <strong>💬 Comentarios</strong>
                <span>${ticket.comentarios}</span>
            </div>
            ` : ''}
            
            ${ticket.fecha_completado ? `
            <div class="detail-row">
                <strong>✅ Fecha de Completado</strong>
                <span>${new Date(ticket.fecha_completado).toLocaleString('es-ES', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}</span>
            </div>
            ` : ''}
        </div>
        
        <div class="ticket-actions">
            <button onclick="changeTicketStatus('${ticket.id}', 'en_proceso')" class="btn btn-primary">
                 Marcar en Proceso
            </button>
            <button onclick="changeTicketStatus('${ticket.id}', 'completado')" class="btn btn-success">
                ✅ Marcar Completado
            </button>
            <button onclick="deleteTicket('${ticket.id}')" class="btn btn-danger">
                🗑️ Eliminar
            </button>
        </div>
    `;
    
    // Mostrar modal con animación
    modal.style.display = 'block';
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);
}

// Función para cambiar el estado del ticket
async function changeTicketStatus(ticketId, newEstado) {
    try {
        const response = await fetch(`/api/solicitudes-rh/${ticketId}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                estado: newEstado,
                comentarios: `Estado cambiado a: ${newEstado}`
            })
        });
        
        if (!response.ok) throw new Error('Error al cambiar estado');
        
        showNotification('Estado cambiado correctamente', 'success');
        closeModal();
        await loadTickets(); // Recargar tickets
    } catch (error) {
        console.error('Error al cambiar estado:', error);
        showNotification('Error al cambiar estado', 'error');
    }
}

// Función para cerrar el modal con animación
function closeModal() {
    const modal = document.getElementById('ticketModal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// Función para cerrar el modal de tickets completados con animación
function closeCompletedModal() {
    const modal = document.getElementById('completedModal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// Inicialización cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    // Cargar tickets iniciales
    loadTickets();
    
    // Configurar drag and drop
    document.querySelectorAll('.kanban-column').forEach(column => {
        column.addEventListener('dragover', handleDragOver);
        column.addEventListener('drop', handleDrop);
    });
    
    // Configurar botón de terminados
    const completedButton = document.getElementById('completedButton');
    if (completedButton) {
        completedButton.addEventListener('click', showCompletedTickets);
        
        // Drag and drop para completar tickets
        completedButton.addEventListener('dragover', (e) => {
            e.preventDefault();
            completedButton.classList.add('drag-over');
            animateCompletedButton(1.3, 150);
        });
        
        completedButton.addEventListener('dragleave', (e) => {
            const rect = completedButton.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;
            
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                completedButton.classList.remove('drag-over');
                animateCompletedButton(1.2, 200);
            }
        });
        
        completedButton.addEventListener('drop', async (e) => {
            e.preventDefault();
            completedButton.classList.remove('drag-over');
            animateCompletedButton(1, 300);
            
            if (draggedTicket) {
                const ticketId = draggedTicket.dataset.ticketId;
                if (ticketId) {
                    try {
                        await completeTicket(ticketId);
                        if (draggedTicket.parentNode) {
                            draggedTicket.parentNode.removeChild(draggedTicket);
                        }
                    } catch (error) {
                        console.error('Error al completar ticket:', error);
                    }
                }
            }
            draggedTicket = null;
        });
    }
    
    // Verificar actualizaciones cada 10 segundos
    setInterval(checkForUpdates, 10000);
    
    // Actualizar indicadores de tiempo cada minuto
    setInterval(updateTimeIndicators, 60000);
});

// Función para actualizar indicadores de tiempo
function updateTimeIndicators() {
    const tickets = document.querySelectorAll('.ticket');
    tickets.forEach(ticket => {
        const timeIndicator = ticket.querySelector('.time-indicator');
        if (timeIndicator) {
            const currentText = timeIndicator.textContent;
            const timeMatch = currentText.match(/(\d+)h (\d+)m/);
            if (timeMatch) {
                let hours = parseInt(timeMatch[1]);
                let minutes = parseInt(timeMatch[2]);
                minutes++;
                if (minutes >= 60) {
                    hours++;
                    minutes = 0;
                }
                
                let timeColor = 'green';
                if (hours >= 4) timeColor = 'red';
                else if (hours >= 2) timeColor = 'orange';
                else if (hours >= 1) timeColor = 'yellow';
                
                timeIndicator.textContent = `Tiempo: ${hours}h ${minutes}m`;
                timeIndicator.className = `time-indicator ${timeColor}`;
            }
        }
    });
}
