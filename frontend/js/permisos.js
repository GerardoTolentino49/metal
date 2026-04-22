window.__permErrorShown = (typeof window.__permErrorShown !== 'undefined') ? window.__permErrorShown : false;

// Función centralizada para verificar permisos
async function verificarPermisosCentral() {
    let username = localStorage.getItem('username');
    
    // Si no hay username, intentar obtenerlo de loggedInUser
    if (!username) {
        const loggedInUser = localStorage.getItem('loggedInUser');
        if (loggedInUser) {
            try {
                const user = JSON.parse(loggedInUser);
                // Usar employeeNumber como username para la API (es el identificador real)
                username = user.employeeNumber || user.name || user.username;
                // Guardar el username correcto para futuras verificaciones
                if (username) {
                    localStorage.setItem('username', username);
                }
            } catch (e) {
                console.error('Error al parsear loggedInUser:', e);
            }
        }
    }
    
    if (!username) {
        window.location.href = 'login.html';
        return false;
    }

    try {
        const response = await fetch('/api/auth/check-permissions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });

        if (!response.ok) {
            throw new Error('Error al verificar permisos');
        }

        const data = await response.json();
        
        // Guardar el rol y permisos en localStorage
        localStorage.setItem('rol', data.user.rol);
        localStorage.setItem('permissions', JSON.stringify(data.permissions));
        localStorage.setItem('userId', data.user.id); // Guardar el id del usuario
        // Intentar cargar y guardar también los permisos de tarjetas (tarjetas_disponibles)
        try {
            const tarjetasResp = await fetch(`/api/tarjetas-disponibles?userId=${encodeURIComponent(data.user.id)}`);
            if (tarjetasResp.ok) {
                const tarjetasData = await tarjetasResp.json();
                if (tarjetasData && tarjetasData.tarjetas) {
                    localStorage.setItem('tarjetasPermisos', JSON.stringify(tarjetasData.tarjetas));
                }
            }
        } catch (e) {
            // No bloquear la verificación de permisos si falla esta petición
            console.warn('No se pudieron cargar permisos de tarjetas:', e?.message || e);
        }
        
        return data;
    } catch (error) {
        console.error('Error al verificar permisos:', error);
        localStorage.clear();
        window.location.href = 'login.html';
        return false;
    }
}

// Función para verificar acceso a una página específica
async function verificarAccesoPagina(pagina) {
    const data = await verificarPermisosCentral();
    if (!data) return false;
        
    // Si es IT, tiene acceso a todo
    if (data.user.rol === 'IT') {
        return true;
    }

    // Verificar acceso según la página
    switch(pagina) 
    {
        case 'panel.html': return data.permissions.includes('tickets');
        case 'detalles.html': return data.permissions.includes('estadisticas');
        case 'detalles_mantenimiento.html': return data.permissions.includes('estadisticas_mantenimiento');
        case 'apoyos.html': return data.permissions.includes('apoyos');
        case 'amonestaciones.html': return data.permissions.includes('amonestaciones');
        case 'design.html': return data.permissions.includes('design');
        case 'nuevo-pm.html': return data.permissions.includes('pm');
        case 'inventario.html': return data.permissions.includes('inventario');
        case 'mantenimiento.html': return data.permissions.includes('mantenimiento');
        case 'admin.html':
        case 'departamentos.html':
        case 'contrasenas.html':
        case 'admin_design.html': return data.user.rol === 'IT';
        case 'inicio.html':
            return true; // Página de inicio siempre accesible
        default:
            return true;
    }
}

// Función para mostrar/ocultar elementos según permisos
async function actualizarInterfazPermisos() 
{
    const data = await verificarPermisosCentral();
    if (!data) {
        return;
    }
    
            
    // Obtener todos los botones principales y submenús
    const itMenuBtn = document.getElementById('itMenuBtn');
    const itSubmenu = document.getElementById('itSubmenu');
    const rhMenuBtn = document.getElementById('rhMenuBtn');
    const rhSubmenu = document.getElementById('rhSubmenu');
    const designMenuBtn = document.getElementById('designMenuBtn');
    const designSubmenu = document.getElementById('designSubmenu');
    const warehouseMenuBtn = document.getElementById('warehouseMenuBtn');
    const warehouseSubmenu = document.getElementById('warehouseSubmenu');
    const maintenanceMenuBtn = document.getElementById('maintenanceMenuBtn');
    const maintenanceSubmenu = document.getElementById('maintenanceSubmenu');
    const pmMenuBtn = document.getElementById('pmMenuBtn');
    const pmSubmenu = document.getElementById('pmSubmenu');
    const adminMenuBtn = document.getElementById('adminMenuBtn');
    const adminSubmenu = document.getElementById('adminSubmenu');


    // Si es IT, mostrar todo
    if (data.user.rol === 'IT') {
        [itMenuBtn, rhMenuBtn, designMenuBtn, warehouseMenuBtn, maintenanceMenuBtn, pmMenuBtn, adminMenuBtn].forEach(elem => {
            if (elem) {
                elem.classList.add('visible');
            }
        });
        
        // Marcar la topbar como lista
        document.body.classList.add('topbar-ready');
        return;
    }

    // Para todos los demás roles, ocultar el menú de administración
    if (adminMenuBtn) adminMenuBtn.classList.remove('visible');

    // Controlar acceso a IT (Tickets y Estadísticas)
    const tieneTickets = data.permissions.includes('tickets');
    const tieneEstadisticas = data.permissions.includes('estadisticas');
    
    if (itMenuBtn) {
        if (tieneTickets || tieneEstadisticas) {
            itMenuBtn.classList.add('visible');
        } else {
            itMenuBtn.classList.remove('visible');
        }
    }

    // Controlar acceso a Recursos Humanos (Apoyos y Amonestaciones)
    const tieneApoyos = data.permissions.includes('apoyos');
    const tieneAmonestaciones = data.permissions.includes('amonestaciones');
    
    if (rhMenuBtn) {
        if (tieneApoyos || tieneAmonestaciones) {
            rhMenuBtn.classList.add('visible');
        } else {
            rhMenuBtn.classList.remove('visible');
        }
    }

    // Controlar acceso a Design
    const tieneDesign = data.permissions.includes('design');
    
    if (designMenuBtn) {
        if (tieneDesign) {
            designMenuBtn.classList.add('visible');
        } else {
            designMenuBtn.classList.remove('visible');
        }
    }

    // Controlar acceso a Warehouse (Inventario)
    const tieneInventario = data.permissions.includes('inventario');
    
    if (warehouseMenuBtn) {
        if (tieneInventario) {
            warehouseMenuBtn.classList.add('visible');
        } else {
            warehouseMenuBtn.classList.remove('visible');
        }
    }

    // Controlar acceso a Maintenance
    const tieneMantenimiento = data.permissions.includes('mantenimiento');
    const tieneEstadisticasMantenimiento = data.permissions.includes('estadisticas_mantenimiento');
    
    if (maintenanceMenuBtn) {
        if (tieneMantenimiento || tieneEstadisticasMantenimiento) {
            maintenanceMenuBtn.classList.add('visible');
        } else {
            maintenanceMenuBtn.classList.remove('visible');
        }
    }

    // Controlar acceso a PM
    const tienePM = data.permissions.includes('pm');
    
    if (pmMenuBtn) {
        if (tienePM) {
            pmMenuBtn.classList.add('visible');
        } else {
            pmMenuBtn.classList.remove('visible');
        }
    }

    // Ocultar elementos específicos dentro de los submenús según permisos
    const ticketsLink = document.querySelector('#itSubmenu a[href="panel.html"]');
    const estadisticasLink = document.querySelector('#itSubmenu a[href="detalles.html"]');
    const apoyosLink = document.querySelector('#rhSubmenu a[href="apoyos.html"]');
    const amonestacionesLink = document.querySelector('#rhSubmenu a[href="amonestaciones.html"]');
    const designLink = document.querySelector('#designSubmenu a[href="design.html"]');
    const inventarioLink = document.querySelector('#warehouseSubmenu a[href="inventario.html"]');
    const mantenimientoLink = document.querySelector('#maintenanceSubmenu a[href="mantenimiento.html"]');
    const estadisticasMantenimientoLink = document.querySelector('#maintenanceSubmenu a[href="detalles_mantenimiento.html"]');
    const pmProyectosLink = document.querySelector('#pmSubmenu a[href="nuevo-pm.html"]');
    const pmEquipoLink = document.querySelector('#pmSubmenu a[href="nuevo-equipo.html"]');
    const pmEstadisticasLink = document.querySelector('#pmSubmenu a[href="detalles_pm.html"]');

    if (ticketsLink) {
        ticketsLink.style.display = tieneTickets ? 'block' : 'none';
    }
    if (estadisticasLink) {
        estadisticasLink.style.display = tieneEstadisticas ? 'block' : 'none';
    }
    if (apoyosLink) {
        apoyosLink.style.display = tieneApoyos ? 'block' : 'none';
    }
    if (amonestacionesLink) {
        amonestacionesLink.style.display = tieneAmonestaciones ? 'block' : 'none';
    }
    if (designLink) {
        designLink.style.display = tieneDesign ? 'block' : 'none';
    }
    if (inventarioLink) {
        inventarioLink.style.display = tieneInventario ? 'block' : 'none';
    }
    if (mantenimientoLink) {
        mantenimientoLink.style.display = tieneMantenimiento ? 'block' : 'none';
    }
    if (estadisticasMantenimientoLink) {
        estadisticasMantenimientoLink.style.display = tieneEstadisticasMantenimiento ? 'block' : 'none';
    }
    if (pmProyectosLink) {
        pmProyectosLink.style.display = tienePM ? 'block' : 'none';
    }
    if (pmEquipoLink) {
        pmEquipoLink.style.display = tienePM ? 'block' : 'none';
    }
    if (pmEstadisticasLink) {
        pmEstadisticasLink.style.display = tienePM ? 'block' : 'none';
    }

    // Si un submenú no tiene elementos visibles, ocultar el botón principal
    if (itSubmenu && !tieneTickets && !tieneEstadisticas) {
        if (itMenuBtn) itMenuBtn.classList.remove('visible');
    }
    if (rhSubmenu && !tieneApoyos && !tieneAmonestaciones) {
        if (rhMenuBtn) rhMenuBtn.classList.remove('visible');
    }
    if (designSubmenu && !tieneDesign) {
        if (designMenuBtn) designMenuBtn.classList.remove('visible');
    }
    if (warehouseSubmenu && !tieneInventario) {
        if (warehouseMenuBtn) warehouseMenuBtn.classList.remove('visible');
    }
    if (maintenanceSubmenu && !tieneMantenimiento && !tieneEstadisticasMantenimiento) {
        if (maintenanceMenuBtn) maintenanceMenuBtn.classList.remove('visible');
    }
    if (pmSubmenu && !tienePM) {
        if (pmMenuBtn) pmMenuBtn.classList.remove('visible');
    }

    // Al final de actualizarInterfazPermisos
    document.body.classList.add('topbar-ready');
}

// Modificar la función checkPermissions existente
async function checkPermissions() {
    const currentPage = window.location.pathname.split('/').pop();
    let username = localStorage.getItem('username');
    
    // Si no hay username, intentar obtenerlo de loggedInUser
    if (!username) {
        const loggedInUser = localStorage.getItem('loggedInUser');
        if (loggedInUser) {
            try {
                const user = JSON.parse(loggedInUser);
                // Usar employeeNumber como username para la API (es el identificador real)
                username = user.employeeNumber || user.name || user.username;
                // Guardar el username correcto para futuras verificaciones
                if (username) {
                    localStorage.setItem('username', username);
                }
            } catch (e) {
                console.error('Error al parsear loggedInUser:', e);
            }
        }
    }
    
    if (!username) {
        window.location.href = 'login.html';
        return;
    }

    // Verificar acceso a la página actual
    const tieneAcceso = await verificarAccesoPagina(currentPage);
    if (!tieneAcceso) {
        if (!window.__permErrorShown) {
            alert('No tienes permiso para acceder a esta página.');
            window.__permErrorShown = true;
        }
        window.location.href = 'inicio.html';
        return;
    }

    // Actualizar la interfaz según permisos
    await actualizarInterfazPermisos();
    
    // Asegurar que la topbar esté lista
    document.body.classList.add('topbar-ready');
}

// Función para verificar si el usuario tiene un permiso específico
async function hasPermission(permission) {
    try {
        let username = localStorage.getItem('username');
        
        // Si no hay username, intentar obtenerlo de loggedInUser
        if (!username) {
            const loggedInUser = localStorage.getItem('loggedInUser');
            if (loggedInUser) {
                try {
                    const user = JSON.parse(loggedInUser);
                    username = user.employeeNumber || user.name || user.username;
                    if (username) {
                        localStorage.setItem('username', username);
                    }
                } catch (e) {
                    console.error('Error al parsear loggedInUser:', e);
                }
            }
        }
        
        if (!username) return false;

        const response = await fetch('/api/auth/check-permissions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });

        if (!response.ok) return false;

        const data = await response.json();
        
        // Si el usuario es IT, siempre retornar true
        if (data.user && data.user.rol === 'IT') {
            return true;
        }
        
        // Verificar si el usuario tiene el permiso específico
        return data.permissions && data.permissions.includes(permission);
    } catch (error) {
        console.error('Error al verificar permiso:', error);
        return false;
    }
}

// Ejecutar la verificación de permisos solo una vez al cargar la página
document.addEventListener('DOMContentLoaded', async function() {
    let username = localStorage.getItem('username');
    
    // Si no hay username, intentar obtenerlo de loggedInUser
    if (!username) {
        const loggedInUser = localStorage.getItem('loggedInUser');
        if (loggedInUser) {
            try {
                const user = JSON.parse(loggedInUser);
                // Usar employeeNumber como username para la API (es el identificador real)
                username = user.employeeNumber || user.name || user.username;
                // Guardar el username correcto para futuras verificaciones
                if (username) {
                    localStorage.setItem('username', username);
                }
            } catch (e) {
                console.error('Error al parsear loggedInUser:', e);
            }
        }

            // Después de que la página cargue, intentar anotar filas inactivas con ausencias
            setTimeout(() => {
                try {
                    annotateInactiveStatusRows();
                } catch (e) {
                    console.warn('Error anotando inactivos:', e);
                }
            }, 350);
    }
    
    if (!username) {
        window.location.href = '/login.html';
        return;
    }

    try {
        const response = await fetch('/api/auth/check-permissions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });

        if (!response.ok) {
            throw new Error('Error al verificar permisos');
        }

        const data = await response.json();
        
        // Mostrar el nombre del usuario
        const userInfo = document.getElementById('userInfo');
        if (userInfo) {
            userInfo.textContent = data.user.nombre_completo;
        }

        // Mostrar la foto del usuario en el icono
        const userIcon = document.getElementById('userIcon');
        if (userIcon && data.user.foto_url) {
            // Limpiar el contenido anterior (ícono de Font Awesome)
            userIcon.innerHTML = '';
            // Crear elemento img para la foto
            const img = document.createElement('img');
            img.src = data.user.foto_url;
            img.alt = data.user.nombre_completo;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            userIcon.appendChild(img);
        }

        // Actualizar la interfaz según permisos
        await actualizarInterfazPermisos();

        // Marcar el enlace activo según la página actual
        const currentPath = window.location.pathname.split('/').pop();
        
        // Remover todas las clases active y selected
        document.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('active', 'selected');
        });

        // Marcar como activo según la página actual
        switch(currentPath) {
            case 'panel.html':
            case 'detalles.html':
                const itMenuBtn = document.getElementById('itMenuBtn');
                if (itMenuBtn) itMenuBtn.classList.add('active', 'selected');
                break;
            case 'apoyos.html':
            case 'amonestaciones.html':
                const rhMenuBtn = document.getElementById('rhMenuBtn');
                if (rhMenuBtn) rhMenuBtn.classList.add('active', 'selected');
                break;
            case 'design.html':
                const designMenuBtn = document.getElementById('designMenuBtn');
                if (designMenuBtn) designMenuBtn.classList.add('active', 'selected');
                break;
            case 'inventario.html':
                const warehouseMenuBtn = document.getElementById('warehouseMenuBtn');
                if (warehouseMenuBtn) warehouseMenuBtn.classList.add('active', 'selected');
                break;
            case 'mantenimiento.html':
            case 'detalles_mantenimiento.html':
                const maintenanceMenuBtn = document.getElementById('maintenanceMenuBtn');
                if (maintenanceMenuBtn) maintenanceMenuBtn.classList.add('active', 'selected');
                break;
            case 'nuevo-pm.html':
            case 'nuevo-equipo.html':
            case 'detalles_pm.html':
                const pmMenuBtnActive = document.getElementById('pmMenuBtn');
                if (pmMenuBtnActive) pmMenuBtnActive.classList.add('active', 'selected');
                break;
            case 'admin.html':
            case 'departamentos.html':
            case 'contrasenas.html':
            case 'admin_design.html':
                const adminMenuBtn = document.getElementById('adminMenuBtn');
                if (adminMenuBtn) adminMenuBtn.classList.add('active', 'selected');
                break;
        }

    } catch (error) {
        console.error('Error:', error);
        alert('Error al verificar permisos');
    }
}); 

// Helper: consulta vacaciones y permisos del empleado y devuelve ausencia activa si existe
async function getActiveAbsenceForEmployee(employeeId) {
    if (!employeeId) return null;
    const now = new Date();
    try {
        // Vacaciones
        const vacResp = await fetch(`/api/vacaciones/empleado/${encodeURIComponent(employeeId)}`);
        if (vacResp.ok) {
            const vacs = await vacResp.json();
            if (Array.isArray(vacs)) {
                for (const v of vacs) {
                    const estado = (v.estado || '').toString().toLowerCase();
                    const inicio = v.fecha_inicio || v.inicio || v.start_date || v.fecha_inicio_solicitud;
                    const fin = v.fecha_fin || v.fin || v.end_date;
                    if (estado === 'aprobada' || estado === 'aprobado') {
                        const dInicio = inicio ? new Date(inicio) : null;
                        const dFin = fin ? new Date(fin) : null;
                        if (dInicio && dFin && !isNaN(dInicio.getTime()) && !isNaN(dFin.getTime())) {
                            if (now >= dInicio && now <= dFin) {
                                return { type: 'vacaciones', item: v };
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Error consultando vacaciones:', e);
    }

    try {
        // Permisos
        const permResp = await fetch(`/api/permisos/empleado/${encodeURIComponent(employeeId)}`);
        if (permResp.ok) {
            const perms = await permResp.json();
            if (Array.isArray(perms)) {
                for (const p of perms) {
                    const estado = (p.estado || '').toString().toLowerCase();
                    const inicio = p.fecha_inicio || p.inicio || p.start_date;
                    const fin = p.fecha_fin || p.fin || p.end_date;
                    if (estado === 'aprobado' || estado === 'aprobada') {
                        const dInicio = inicio ? new Date(inicio) : null;
                        const dFin = fin ? new Date(fin) : null;
                        if (dInicio && dFin && !isNaN(dInicio.getTime()) && !isNaN(dFin.getTime())) {
                            if (now >= dInicio && now <= dFin) {
                                return { type: 'permiso', item: p };
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Error consultando permisos:', e);
    }

    return null;
}

// Formatea una etiqueta pequeña para ausencias
function buildAbsencePill(absence) {
    if (!absence) return '';
    if (absence.type === 'vacaciones') {
        const inicio = absence.item.fecha_inicio || absence.item.inicio || '';
        const fin = absence.item.fecha_fin || absence.item.fin || '';
        const title = inicio && fin ? `Vacaciones: ${inicio} → ${fin}` : 'Vacaciones activas';
        return `<span class="status-pill" title="${title}" style="background:#fff1f2;color:#7f1d1d;border:1px solid #fecaca;">Vacaciones</span>`;
    }
    if (absence.type === 'permiso') {
        const inicio = absence.item.fecha_inicio || absence.item.inicio || '';
        const fin = absence.item.fecha_fin || absence.item.fin || '';
        const title = inicio && fin ? `Permiso: ${inicio} → ${fin}` : 'Permiso activo';
        return `<span class="status-pill" title="${title}" style="background:#eff6ff;color:#1e3a8a;border:1px solid #93c5fd;">Permiso</span>`;
    }
    return '';
}

// Recorre la página y anota filas donde el estado es inactivo
async function annotateInactiveStatusRows() {
    // Buscar elementos que contienen la etiqueta de estado con texto Inactivo
    const statusElements = Array.from(document.querySelectorAll('.status-pill, .user-session-state-chip, .admin-it-pill'));
    for (const el of statusElements) {
        try {
            const text = (el.textContent || '').toString().trim().toLowerCase();
            if (!text || !text.includes('inactivo')) continue;

            // Encontrar la fila contenedora
            const row = el.closest('tr') || el.closest('.user-item') || el.closest('.schedule-user-main-row');
            if (!row) continue;

            // Intentar obtener id de empleado
            let empId = row.getAttribute('data-user-id') || row.getAttribute('data-usuario-id') || row.getAttribute('data-usuario-id') || row.getAttribute('data-user') || row.dataset?.userid || row.dataset?.userId;
            if (!empId) {
                // buscar en atributos del row
                const attrs = ['data-usuario-id','data-user-id','data-employee-id','data-employee'];
                for (const a of attrs) {
                    if (row.getAttribute(a)) { empId = row.getAttribute(a); break; }
                }
            }

            // Si empId sigue vacío, intentar extraer número del primer link o texto del nombre
            if (!empId) {
                const maybe = row.querySelector('td')?.textContent || '';
                const m = maybe.match(/\b(\d{2,6})\b/);
                if (m) empId = m[1];
            }

            if (!empId) continue;

            const absence = await getActiveAbsenceForEmployee(empId);
            if (absence) {
                el.outerHTML = buildAbsencePill(absence);
            }
        } catch (e) {
            console.warn('Error procesando elemento de estado:', e);
        }
    }
}

window.getActiveAbsenceForEmployee = getActiveAbsenceForEmployee;
window.annotateInactiveStatusRows = annotateInactiveStatusRows;