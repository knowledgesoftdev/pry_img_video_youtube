const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { main } = require('./indexImagenes');
//const { mainVideos } = require('./indexVideos');
const { mainVideosLargos } = require('./indexVideosLargos')

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware para servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

io.on('connection', (socket) => {
    console.log('🟢 Cliente conectado');

    socket.on('disconnect', () => {
        console.log('🔴 Cliente desconectado');
    });
});

// Middleware para enviar logs al cliente
function logToClient(message) {
    console.log(message);
    io.emit('log', message);
}

// Configuración de almacenamiento para multer
const storage = multer.diskStorage({
    destination: 'uploads',
    filename: (req, file, cb) => {
        cb(null, 'original-audio.mp4');
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'video/mp4') {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos MP4'));
        }
    }
});


// Configuración de FFmpeg
ffmpeg.setFfmpegPath('C:/ffmpeg/bin/ffmpeg.exe');
ffmpeg.setFfprobePath('C:/ffmpeg/bin/ffprobe.exe');

// Asegurar directorios
['uploads', 'audio'].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
});

// Función para extraer audio de MP4
function convertMP4ToMP3(inputPath) {
    const outputPath = path.join(__dirname, 'audio', 'voice.mp3');
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('mp3')
            .on('start', () => logToClient('🎙 Iniciando extracción de audio...'))
            .on('end', () => {
                logToClient('✅ Audio extraído con éxito');
                resolve(outputPath);
            })
            .on('error', reject)
            .save(outputPath);
    });
}

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta para subir archivo y recibir el script
app.post('/subir', upload.single('video'), async (req, res) => {
    const { script, orientation, mediaType } = req.body;

    if (!script) {
        return res.status(400).json({ error: 'Falta el script' });
    }

    logToClient('🔄 Convirtiendo MP4 a MP3...');
    const inputPath = path.join(__dirname, 'uploads', 'original-audio.mp4');

    try {
        await convertMP4ToMP3(inputPath);
        logToClient('✅ Conversión finalizada. Generando video...');
        if (mediaType === 'video') {
            await mainVideosLargos(script, io, { orientation });
        } else {
            await main(script, io, {
                orientation,
                mediaType,
                inputPath
            });
        }
        res.json({ message: '✅ Proceso completado' });
    } catch (error) {
        logToClient(`❌ Error en el proceso: ${error.message}`);
        res.status(500).json({ error: 'Error en el procesamiento' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
});