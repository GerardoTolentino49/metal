document.addEventListener("DOMContentLoaded", function () {
    const ticketForm = document.getElementById("ticketForm");
    const summarySection = document.getElementById("summarySection");
    const responseMessage = document.getElementById("responseMessage");

    // Campos de resumen
    const summaryName = document.getElementById("summaryName");
    const summaryDepartment = document.getElementById("summaryDepartment");
    const summaryIssue = document.getElementById("summaryIssue");
    const summaryPhotos = document.getElementById("summaryPhotos");

    // Botones de resumen
    const confirmButton = document.getElementById("confirmButton");
    const cancelButton = document.getElementById("cancelButton");

    let formData; // Guardar datos temporalmente

    // Asegurarse de que todos los elementos existen
    if (!ticketForm || !summarySection || !responseMessage || 
        !summaryName || !summaryDepartment || !summaryIssue || !summaryPhotos || 
        !confirmButton || !cancelButton) {
        console.error("Algunos elementos del formulario no se encontraron en el DOM");
        return; // Salir si faltan elementos
    }

    ticketForm.addEventListener("submit", function (e) {
        e.preventDefault();

        formData = new FormData(ticketForm);

        // Mostrar resumen
        summaryName.textContent = formData.get("name");
        summaryDepartment.textContent = formData.get("department");
        summaryIssue.textContent = formData.get("issue");

        const files = formData.getAll("photos");
        if (files.length > 0 && files[0].name !== "") {
            summaryPhotos.textContent = files.map(file => file.name).join(", ");
        } else {
            summaryPhotos.textContent = "No se adjuntaron fotos.";
        }

        ticketForm.style.display = "none";
        summarySection.style.display = "block";
        
        // Asegurar que el mensaje de respuesta esté vacío al mostrar el resumen
        responseMessage.textContent = "";
        responseMessage.style.display = "none";
    });

    confirmButton.addEventListener("click", function () {
        responseMessage.style.display = "block"; // Mostrar el área de mensaje
        responseMessage.textContent = "Enviando ticket..."; // Mensaje mientras se envía
        
        fetch('/tickets', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Error en la respuesta del servidor: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            responseMessage.textContent = "✅ Ticket enviado correctamente. Gracias.";
            ticketForm.reset(); // Limpia el formulario para un nuevo ticket
        })
        .catch(error => {
            responseMessage.textContent = "❌ Hubo un error al enviar el ticket.";
            console.error("Error al enviar:", error);
        })
        .finally(() => {
            summarySection.style.display = "none";
            ticketForm.style.display = "block"; // Mostrar formulario después del envío
        });
    });

    cancelButton.addEventListener("click", function () {
        summarySection.style.display = "none";
        ticketForm.style.display = "block";
        responseMessage.style.display = "none";
    });
});