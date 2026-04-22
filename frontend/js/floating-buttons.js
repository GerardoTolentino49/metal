// Funcionalidad de botones flotantes para el panel
document.addEventListener('DOMContentLoaded', function() {
  // Botón de chat
  const chatButton = document.getElementById('chatButton');
  const messagesModal = document.getElementById('messagesModal');
  const closeMessages = document.getElementById('closeMessages');
  const ticketsList = document.getElementById('ticketsList');

  if (chatButton) {
    chatButton.addEventListener('click', function() {
      loadOpenTickets();
      messagesModal.style.display = 'flex';
    });
  }

  if (closeMessages) {
    closeMessages.addEventListener('click', function() {
      messagesModal.style.display = 'none';
    });
  }

  // Cerrar modal al hacer clic fuera
  window.addEventListener('click', function(event) {
    if (event.target === messagesModal) {
      messagesModal.style.display = 'none';
    }
  });

  // Botón de subir PDF
  const uploadPdfButton = document.getElementById('uploadPdfButton');
  const pdfInput = document.getElementById('pdfInput');
  const pdfPreviewModal = document.getElementById('pdfPreviewModal');
  const pdfPreviewFrame = document.getElementById('pdfPreviewFrame');
  const closePdfPreview = document.getElementById('closePdfPreview');
  const uploadPdfConfirm = document.getElementById('uploadPdfConfirm');

  if (uploadPdfButton) {
    uploadPdfButton.addEventListener('click', function() {
      pdfInput.click();
    });
  }

  if (pdfInput) {
    pdfInput.addEventListener('change', function(event) {
      const file = event.target.files[0];
      if (file && file.type === 'application/pdf') {
        const url = URL.createObjectURL(file);
        pdfPreviewFrame.src = url;
        pdfPreviewModal.style.display = 'flex';
      } else {
        alert('Por favor selecciona un archivo PDF válido');
      }
    });
  }

  if (closePdfPreview) {
    closePdfPreview.addEventListener('click', function() {
      pdfPreviewModal.style.display = 'none';
      pdfInput.value = '';
      pdfPreviewFrame.src = '';
    });
  }

  if (uploadPdfConfirm) {
    uploadPdfConfirm.addEventListener('click', async function() {
      const file = pdfInput.files[0];
      if (!file) {
        alert('Por favor selecciona un archivo PDF');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch('/api/upload-pdf', {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          alert('PDF subido exitosamente');
          pdfPreviewModal.style.display = 'none';
          pdfInput.value = '';
          pdfPreviewFrame.src = '';
        } else {
          throw new Error('Error al subir el PDF');
        }
      } catch (error) {
        console.error('Error:', error);
        alert('Error al subir el PDF: ' + error.message);
      }
    });
  }

  // Botón de ajustes
  const settingsButton = document.getElementById('settingsButton');
  const settingsModal = document.getElementById('settingsModal');
  const showPdfSwitch = document.getElementById('showPdfSwitch');
  const pdfDuration = document.getElementById('pdfDuration');

  if (settingsButton) {
    settingsButton.addEventListener('click', function() {
      loadSettings();
      settingsModal.style.display = 'flex';
    });
  }

  // Cargar ajustes guardados
  function loadSettings() {
    const showPdf = localStorage.getItem('showPdf') === 'true';
    const duration = localStorage.getItem('pdfDuration') || '10';
    
    if (showPdfSwitch) showPdfSwitch.checked = showPdf;
    if (pdfDuration) pdfDuration.value = duration;
  }

  // Guardar ajustes
  window.saveSettings = function() {
    const showPdf = showPdfSwitch ? showPdfSwitch.checked : false;
    const duration = pdfDuration ? pdfDuration.value : '10';
    
    localStorage.setItem('showPdf', showPdf);
    localStorage.setItem('pdfDuration', duration);
    
    alert('Ajustes guardados correctamente');
    settingsModal.style.display = 'none';
  };

  // Cerrar modal de ajustes
  window.closeSettingsModal = function() {
    settingsModal.style.display = 'none';
  };

  // Cerrar modal al hacer clic fuera
  window.addEventListener('click', function(event) {
    if (event.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
  });

  // Variables para el polling de mensajes
  let currentChatTicketId = null;
  let chatPollingInterval = null;

  // Función para cargar tickets abiertos
  async function loadOpenTickets() {
    try {
      const response = await fetch('/api/tickets');
      if (!response.ok) throw new Error('Error al cargar tickets');
      
      const tickets = await response.json();
      const openTickets = tickets.filter(ticket => ticket.urgency !== 'completed');
      
      if (ticketsList) {
        ticketsList.innerHTML = '';
        
        if (openTickets.length === 0) {
          ticketsList.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No hay tickets abiertos</div>';
          return;
        }
        
        openTickets.forEach(ticket => {
          const ticketElement = document.createElement('div');
          ticketElement.className = 'ticket-name';
          ticketElement.setAttribute('data-ticket-id', ticket.id);
          ticketElement.setAttribute('data-user-name', ticket.name);
          ticketElement.textContent = ticket.name;
          
          // Hacer que el nombre sea clickeable
          ticketElement.addEventListener('click', function() {
            const ticketId = this.getAttribute('data-ticket-id');
            const userName = this.getAttribute('data-user-name');
            openChatInModal(ticketId, userName);
          });
          
          ticketsList.appendChild(ticketElement);
        });
      }
    } catch (error) {
      console.error('Error al cargar tickets:', error);
      if (ticketsList) {
        ticketsList.innerHTML = '<div style="text-align: center; padding: 20px; color: #dc3545;">Error al cargar tickets</div>';
      }
    }
  }

  // Nueva función para abrir chat dentro del modal
  function openChatInModal(ticketId, userName) {
    const modalContent = document.querySelector('.messages-modal-content');
    const messagesHeader = document.querySelector('.messages-header');
    
    // Cambiar el contenido del modal para mostrar el chat
    modalContent.innerHTML = `
      <div class="messages-header">
        <h3>Chat con ${userName}</h3>
        <button class="close-messages" onclick="closeChatInModal()">×</button>
      </div>
      <div class="chat-messages" id="modalChatMessages">
        <!-- Los mensajes se cargarán aquí -->
      </div>
      <div class="chat-input-container">
        <input type="text" class="chat-input" id="modalMessageInput" placeholder="Escribe un mensaje...">
        <button class="send-message-btn" id="modalSendMessage">
          <i class="fas fa-paper-plane"></i>
        </button>
      </div>
    `;
    
    const chatMessages = document.getElementById('modalChatMessages');
    const messageInput = document.getElementById('modalMessageInput');
    const sendMessage = document.getElementById('modalSendMessage');
    
    // Cargar mensajes existentes
    loadChatMessages(ticketId, chatMessages);
    
    // Evento para enviar mensaje
    sendMessage.addEventListener('click', function() {
      sendChatMessage(ticketId, messageInput.value, chatMessages);
      messageInput.value = '';
    });
    
    // Evento para enviar con Enter
    messageInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        sendChatMessage(ticketId, messageInput.value, chatMessages);
        messageInput.value = '';
      }
    });
  }

  // Función para cerrar el chat y volver a la lista de tickets
  function closeChatInModal() {
    loadOpenTickets(); // Recargar la lista de tickets
  }

  // Función para iniciar polling de mensajes
  function startChatPolling(ticketId, chatMessages) {
    stopChatPolling(); // Limpiar si ya hay uno
    chatPollingInterval = setInterval(() => {
      loadChatMessages(ticketId, chatMessages);
    }, 3000); // Actualizar cada 3 segundos
  }

  // Función para detener polling de mensajes
  function stopChatPolling() {
    if (chatPollingInterval) {
      clearInterval(chatPollingInterval);
      chatPollingInterval = null;
    }
    currentChatTicketId = null;
  }

  // Función para cargar mensajes del chat
  async function loadChatMessages(ticketId, chatMessages) {
    try {
      const response = await fetch(`/api/tickets/${ticketId}/messages`);
      if (!response.ok) throw new Error('Error al cargar mensajes');
      
      const messages = await response.json();
      
      if (chatMessages) {
        chatMessages.innerHTML = '';
        messages.forEach(message => {
          const messageElement = document.createElement('div');
          // Corregir la lógica: is_staff true = staff (derecha), is_staff false = usuario (izquierda)
          const isStaff = (message.is_staff === true || message.is_staff === 'true');
          messageElement.className = `message-bubble ${isStaff ? 'sent' : 'received'}`;
          
          const time = new Date(message.timestamp).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
          });
          
          messageElement.innerHTML = `
            <div class="message-content">${message.content}</div>
            <div class="message-time">${time}</div>
          `;
          chatMessages.appendChild(messageElement);
        });
        
        // Scroll al final
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    } catch (error) {
      console.error('Error al cargar mensajes:', error);
    }
  }

  // Función para enviar mensaje
  async function sendChatMessage(ticketId, content, chatMessages) {
    if (!content.trim()) return;

    try {
      const response = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: content,
          is_staff: true // true porque es el staff quien envía
        })
      });

      if (response.ok) {
        // Recargar mensajes inmediatamente para mostrar el nuevo mensaje
        await loadChatMessages(ticketId, chatMessages);
      } else {
        throw new Error('Error al enviar mensaje');
      }
    } catch (error) {
      console.error('Error al enviar mensaje:', error);
      alert('Error al enviar mensaje');
    }
  }

  // Actualizar contador de mensajes no leídos
  function updateUnreadCount() {
    const unreadCount = document.getElementById('unreadCount');
    if (unreadCount) {
      // Aquí puedes implementar la lógica para obtener el número de mensajes no leídos
      // Por ahora lo dejamos como placeholder
      const count = 0; // Obtener de la API
      if (count > 0) {
        unreadCount.textContent = count;
        unreadCount.style.display = 'block';
      } else {
        unreadCount.style.display = 'none';
      }
    }
  }

  // Actualizar contador cada 30 segundos
  setInterval(updateUnreadCount, 30000);
  updateUnreadCount(); // Actualizar inmediatamente
});
