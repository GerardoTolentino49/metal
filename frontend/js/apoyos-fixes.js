// Correcciones para apoyos.html

document.addEventListener('DOMContentLoaded', function() {
  // Variable para rastrear el apoyo actual que se está editando
  let apoyoActualEditando = null;

  // Agregar event listeners para los filtros
  const filterType = document.getElementById('filterType');
  const filterStatus = document.getElementById('filterStatus');
  
  if (filterType) {
    filterType.addEventListener('change', function() {
      if (typeof updateHistoryTable === 'function') {
        updateHistoryTable();
      }
    });
  }

  if (filterStatus) {
    filterStatus.addEventListener('change', function() {
      if (typeof updateHistoryTable === 'function') {
        updateHistoryTable();
      }
    });
  }

  // Sobrescribir la función viewSupportDetails para rastrear el apoyo actual
  if (typeof viewSupportDetails !== 'undefined') {
    const originalViewSupportDetails = viewSupportDetails;
    
    window.viewSupportDetails = function(supportId) {
      console.log('Buscando apoyo con ID:', supportId);
      console.log('Tipo de ID recibido:', typeof supportId);
      
      // Convertir el ID a string para asegurar una comparación consistente
      const supportIdStr = String(supportId);
      
      // Buscar el apoyo en el historial
      const support = supportHistory.find(s => String(s.id) === supportIdStr);
      
      if (!support) {
        console.error('Apoyo no encontrado:', supportId);
        console.error('IDs disponibles:', supportHistory.map(s => s.id));
        alert('Apoyo no encontrado');
        return;
      }

      // Guardar referencia al apoyo actual que se está editando
      apoyoActualEditando = support;

      console.log('Apoyo encontrado:', support);

      // Función para formatear la fecha al formato YYYY-MM-DD
      function formatDateInput(fecha) {
        if (!fecha) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
        return fecha.split('T')[0];
      }

      // Llenar los campos con los datos del apoyo usando los nombres correctos de las propiedades
      document.getElementById('folio').value = support.folio || '';
      document.getElementById('valeStatus').value = support.estado || 'pendiente';
      document.getElementById('description').value = support.descripcion || '';
      document.getElementById('materialStatus').value = support.estatus_material || '';
      document.getElementById('materialOutDate').value = formatDateInput(support.fecha_salida_herramienta);
      document.getElementById('materialReturnDate').value = formatDateInput(support.fecha_regreso_herramienta);
      document.getElementById('toolLoan').value = support.tool_loan || '';
      document.getElementById('notes').value = support.notas || '';
      
      // Mostrar la foto del empleado si existe
      const photoContainer = document.getElementById('employeePhoto');
      const holoShine = photoContainer.querySelector('.holo-shine');
      const photoImg = photoContainer.querySelector('img');
      const photoPlaceholder = photoContainer.querySelector('.photo-placeholder');
      if (support.foto_url) {
        // Mostrar la foto y ocultar el highlight
        photoImg.src = support.foto_url;
        photoImg.style.opacity = '1';
        if (holoShine) holoShine.style.opacity = '0';
        if (photoPlaceholder) photoPlaceholder.style.display = 'none';
      } else {
        // No hay foto: mostrar highlight y placeholder
        photoImg.src = '';
        photoImg.style.opacity = '0';
        if (holoShine) holoShine.style.opacity = '1';
        if (photoPlaceholder) photoPlaceholder.style.display = 'flex';
      }
      
      // Mostrar evidencias guardadas
      ['evidencia1', 'evidencia2', 'evidencia3'].forEach((evi, idx) => {
        const container = document.getElementById(evi);
        const url = support[evi];
        if (url) {
          container.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
        } else {
          container.innerHTML = `<span>Foto de Evidencia ${idx + 1}</span>`;
        }
      });
      
      // Mostrar la sección adicional
      const additionalInfo = document.getElementById('additionalInfo');
      const collapsibleHeader = document.querySelector('.collapsible-header');
      const collapsibleContent = document.querySelector('.collapsible-content');
      
      if (additionalInfo) additionalInfo.style.display = 'block';
      if (collapsibleHeader) collapsibleHeader.classList.add('active');
      if (collapsibleContent) collapsibleContent.classList.add('active');
      
      // Habilitar todos los campos para edición
      const allInputs = document.querySelectorAll('#additionalInfo input, #additionalInfo select, #additionalInfo textarea');
      allInputs.forEach(input => {
        input.disabled = false;
        input.readOnly = false;
        input.style.background = 'var(--bg-color)';
        input.style.cursor = 'text';
        input.style.opacity = '1';
      });
      
      document.getElementById('saveButton').style.display = 'block';
      
      const lastModifiedBy = document.getElementById('lastModifiedBy');
      if (support.modificado_por && support.ultima_modificacion) {
        const fechaObj = new Date(support.ultima_modificacion);
        const fecha = fechaObj.toLocaleDateString();
        const hora = fechaObj.toLocaleTimeString();
        lastModifiedBy.textContent = `Última modificación hecha por: ${support.modificado_por} el ${fecha} a las ${hora}`;
      }
    };
  }

  // Sobrescribir la función de guardado para usar el apoyo actual editando
  const saveButton = document.getElementById('saveButton');
  if (saveButton) {
    // Remover el event listener existente
    const newSaveButton = saveButton.cloneNode(true);
    saveButton.parentNode.replaceChild(newSaveButton, saveButton);
    
    newSaveButton.addEventListener('click', async function() {
      const username = localStorage.getItem('username');
      if (!username) {
        mostrarNotificacionError('No hay sesión activa');
        return;
      }

      try {
        // Obtener el nombre completo del usuario
        const userResponse = await fetch('/api/auth/check-permissions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username })
        });

        if (!userResponse.ok) {
          throw new Error('Error al obtener información del usuario');
        }

        const userData = await userResponse.json();
        const nombreCompleto = userData.user.nombre_completo;

        const employeeId = document.getElementById('employeeId').value;
        if (!employeeId) {
          mostrarNotificacionError('Por favor busque un empleado primero');
          return;
        }

        // Obtener el folio actual
        const folio = document.getElementById('folio').value.trim();
        if (!folio) {
          mostrarNotificacionError('El folio es obligatorio');
          return;
        }

        // Obtener el estado actual del vale
        const valeStatus = document.getElementById('valeStatus').value;
        const manualDate = document.getElementById('manualLastSupportDate').value;
        let currentDate;
        if (manualDate && manualDate.trim() !== "") {
          currentDate = manualDate;
        } else {
          currentDate = new Date().toISOString();
        }

        // Habilitar los campos de fecha para asegurar que sus valores se recojan correctamente
        document.getElementById('materialOutDate').disabled = false;
        document.getElementById('materialReturnDate').disabled = false;

        // Determinar el tipo de apoyo correcto
        let tipoApoyo = 'simple'; // Por defecto
        let apoyoExistente = null;
        
        // Si estamos editando un apoyo existente, usar su información
        if (apoyoActualEditando) {
          apoyoExistente = apoyoActualEditando;
          tipoApoyo = apoyoActualEditando.tipo || 'simple';
        } else {
          // Buscar en el historial si ya existe un apoyo con ese folio
          apoyoExistente = supportHistory.find(s => String(s.folio) === folio);
          
          if (apoyoExistente) {
            // Si es un apoyo existente, usar el tipo que ya tiene
            tipoApoyo = apoyoExistente.tipo || 'simple';
          } else {
            // Si es un nuevo apoyo, buscar en el historial el más reciente (que debería ser el que se acaba de crear)
            if (supportHistory.length > 0) {
              tipoApoyo = supportHistory[0].tipo || 'simple';
            }
          }
        }

        // Recolectar todos los datos del formulario con los nombres correctos de las propiedades
        const formData = {
          id: employeeId,
          nombre_completo: document.getElementById('fullName').value,
          supervisor: document.getElementById('supervisor').value,
          puesto: document.getElementById('position').value,
          folio: folio,
          vale_status: valeStatus,
          descripcion: document.getElementById('description').value,
          estatus_material: document.getElementById('materialStatus').value,
          fecha_salida_herramienta: document.getElementById('materialOutDate').value,
          fecha_regreso_herramienta: document.getElementById('materialReturnDate').value,
          tool_loan: document.getElementById('toolLoan').value,
          notas: document.getElementById('notes').value,
          ultima_modificacion: currentDate,
          modificado_por: nombreCompleto,
          tipo: tipoApoyo,
          fecha: currentDate,
          estado: valeStatus
        };

        let responseData;
        if (apoyoExistente) {
          // Si existe, actualizar (PUT)
          const apoyoResponse = await fetch(`/api/empleados/apoyos/${apoyoExistente.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
          });
          if (!apoyoResponse.ok) {
            throw new Error('Error al actualizar el apoyo existente');
          }
          responseData = await apoyoResponse.json();
        } else {
          // Si no existe, crear (POST)
          const apoyoResponse = await fetch('/api/empleados/apoyos', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
          });
          if (!apoyoResponse.ok) {
            throw new Error('Error al crear el apoyo');
          }
          responseData = await apoyoResponse.json();
        }
        
        // Limpiar la referencia al apoyo actual editando
        apoyoActualEditando = null;
        
        // Actualizar la tabla después de guardar
        if (typeof loadSupportHistory === 'function') {
          await loadSupportHistory();
        }
        
        if (typeof mostrarNotificacionGuardado === 'function') {
          mostrarNotificacionGuardado();
        }
      } catch (error) {
        console.error('Error:', error);
        if (typeof mostrarNotificacionError === 'function') {
          mostrarNotificacionError('Error al guardar los cambios: ' + error.message);
        }
      }
    });
  }
});