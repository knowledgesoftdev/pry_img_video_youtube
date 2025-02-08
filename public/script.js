// Conectar con Socket.IO
const socket = io();

// Obtener elementos del DOM
const uploadForm = document.getElementById('uploadForm');
const statusMessage = document.getElementById('statusMessage');
const logsDiv = document.getElementById('logs');
const mediaTypeSelect = document.getElementById('mediaType');
const mediaFileInput = document.getElementById('mediaFile');
const orientationSelect = document.getElementById('orientation');
const previewContainer = document.querySelector('.preview-container');
const mediaPreview = document.getElementById('mediaPreview');

// Escuchar eventos de socket para mostrar logs
socket.on('log', (message) => {
    // Crear y agregar el mensaje al div de logs
    const logEntry = document.createElement('p');
    logEntry.textContent = message;
    logsDiv.appendChild(logEntry);
    
    // Auto-scroll hacia abajo
    logsDiv.scrollTop = logsDiv.scrollHeight;
    
    // Actualizar también el mensaje de estado
    statusMessage.textContent = message;
});



// Mostrar vista previa del archivo seleccionado
mediaFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) {
        clearPreview();
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        previewContainer.style.display = 'block';
        mediaPreview.innerHTML = '';

        if (file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = event.target.result;
            video.controls = true;
            mediaPreview.appendChild(video);
        } else if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = event.target.result;
            mediaPreview.appendChild(img);
        }
    };
    reader.readAsDataURL(file);
});

// Limpiar vista previa
function clearPreview() {
    previewContainer.style.display = 'none';
    mediaPreview.innerHTML = '';
}

// Manejar el envío del formulario
uploadForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const formData = new FormData();
    formData.append('script', document.getElementById('script').value);
    formData.append('mediaType', mediaTypeSelect.value);
    formData.append('video', mediaFileInput.files[0]);
    formData.append('orientation', orientationSelect.value);

    try {
        statusMessage.textContent = '🔄 Procesando...';
        
        const response = await fetch('/subir', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        statusMessage.textContent = result.message;
    } catch (error) {
        statusMessage.textContent = '❌ Error en el proceso';
        console.error(error);
    }
});