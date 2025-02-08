const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');
const translate = require('@vitalets/google-translate-api');

// Set FFmpeg paths
const ffmpegPath = 'C:/ffmpeg/bin/ffmpeg.exe';
const ffprobePath = 'C:/ffmpeg/bin/ffprobe.exe';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const PEXELS_API_KEY = 'YvvUFoxGmsUnT8lvRw2TuErgbYPy3skervQFsmrSIOSkYegbx3mdnjrU';
const PEXELS_API_URL = 'https://api.pexels.com/v1/search';
const AUDIO_PATH = path.join(__dirname, 'audio', 'voice.mp3');
const BACKGROUND_MUSIC_PATH = path.join(__dirname, 'audio', 'background.mp3');

function limpiarArchivosTemporales() {
    const carpetasALimpiar = [
        path.join(__dirname, 'imagenes'), // Carpeta de imágenes
        path.join(__dirname, 'uploads'),  // Carpeta de uploads
    ];

    const archivosAEliminar = [
        path.join(__dirname, 'imagenes.txt'), // Archivo de lista de imágenes
    ];

    // Eliminar archivos
    archivosAEliminar.forEach((archivo) => {
        try {
            if (fs.existsSync(archivo)) {
                fs.unlinkSync(archivo);
                console.log(`🗑️ Archivo eliminado: ${archivo}`);
            }
        } catch (error) {
            console.error(`❌ Error eliminando archivo ${archivo}:`, error);
        }
    });

    // Limpiar carpetas (eliminar solo su contenido)
    carpetasALimpiar.forEach((carpeta) => {
        try {
            if (fs.existsSync(carpeta)) {
                fs.readdirSync(carpeta).forEach((archivo) => {
                    const rutaCompleta = path.join(carpeta, archivo);
                    fs.unlinkSync(rutaCompleta);
                    console.log(`🗑️ Archivo eliminado: ${rutaCompleta}`);
                });
                console.log(`🧹 Contenido de la carpeta eliminado: ${carpeta}`);
            }
        } catch (error) {
            console.error(`❌ Error limpiando carpeta ${carpeta}:`, error);
        }
    });

    // Limpiar la carpeta de audio, excepto background.mp3
    const carpetaAudio = path.join(__dirname, 'audio');
    try {
        if (fs.existsSync(carpetaAudio)) {
            fs.readdirSync(carpetaAudio).forEach((archivo) => {
                if (archivo !== 'background.mp3') { // Excluir background.mp3
                    const rutaCompleta = path.join(carpetaAudio, archivo);
                    fs.unlinkSync(rutaCompleta);
                    console.log(`🗑️ Archivo eliminado: ${rutaCompleta}`);
                }
            });
        }
    } catch (error) {
        console.error(`❌ Error limpiando carpeta de audio:`, error);
    }
}

// Check FFmpeg installation
exec('ffmpeg -version', (error, stdout, stderr) => {
    if (error) {
        console.error(`❌ Error al ejecutar FFmpeg: ${error.message}`);
        return;
    }
    console.log(`✅ FFmpeg está disponible:\n${stdout}`);
});



function dividirGuion(guion) {
    const partes = guion.split(/(?:\r?\n\r?\n+|\. )/);
    return partes.filter(parte => parte.trim().length > 0).slice(0, 8);
}

function generarPrompts(shorts) {
    return shorts.map(short => `Imagen inspirada en: ${short.trim().slice(0, 100)}...`);
}

// Función para traducir texto
async function traducirTexto(texto, io) {
    try {
        io.emit('log', '🌐 Traduciendo guion al inglés...');
        const resultado = await translate.translate(texto, { to: 'en' });
        io.emit('log', '✅ Guion traducido exitosamente');
        return resultado.text;
    } catch (error) {
        io.emit('log', '❌ Error en la traducción del guion');
        console.error('Error en la traducción:', error);
        throw error;
    }
}

async function buscarImagenes(prompt, io) {
    try {
        io.emit('log', `🔍 Buscando imagen para prompt: ${prompt}`);
        const response = await fetch(`${PEXELS_API_URL}?query=${encodeURIComponent(prompt)}&per_page=100`, {
            headers: { Authorization: PEXELS_API_KEY }
        });

        if (!response.ok) {
            throw new Error(`Error en la respuesta de la API: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.photos || data.photos.length === 0) {
            io.emit('log', `⚠️ No se encontraron imágenes para: ${prompt}`);
            return null;
        }

        return data.photos[0].src.original;
    } catch (error) {
        io.emit('log', `❌ Error buscando imagen para prompt: ${prompt}`);
        console.error(`Error buscando imagen para prompt: ${prompt}`, error);
        return null;
    }
}

async function descargarImagen(url, nombreArchivo, orientation, io) {
    try {
        io.emit('log', `📥 Descargando imagen: ${nombreArchivo}`);
        const response = await fetch(url);
        const buffer = await response.buffer();
        const outputDir = path.join(__dirname, 'imagenes');

        // Asegurarse de que la carpeta de imágenes exista
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const dimensions = orientation === 'vertical'
            ? { width: 1080, height: 1920 }  // 9:16
            : { width: 1920, height: 1080 }; // 16:9

        // Resize and crop image to landscape orientation
        const resizedPath = path.join(outputDir, nombreArchivo.replace('.jpg', '_resized.jpg'));
        await sharp(buffer)
            .resize({
                ...dimensions,
                fit: 'cover',
                position: 'center'
            })
            .toFile(resizedPath);

        io.emit('log', `✅ Imagen procesada en ${orientation}: ${nombreArchivo}`);
        return resizedPath;
    } catch (error) {
        io.emit('log', `❌ Error procesando imagen ${nombreArchivo}`);
        console.error(`Error procesando imagen ${nombreArchivo}:`, error);
        throw error;
    }
}

async function procesarImagenes(prompts, orientation, io) {
    const imagenesProcesadas = [];
    for (let i = 0; i < prompts.length; i++) {
        try {
            const prompt = prompts[i];
            const imagenUrl = await buscarImagenes(prompt, io);

            if (!imagenUrl) {
                io.emit('log', `⚠️ No se encontró una imagen para el prompt: ${prompt}. Omitiendo...`);
                continue; // Continuar con el siguiente prompt
            }

            const nombreArchivo = `short_${i + 1}.jpg`;
            const rutaImagen = await descargarImagen(imagenUrl, nombreArchivo, orientation, io);
            imagenesProcesadas.push(rutaImagen);
        } catch (error) {
            io.emit('log', `❌ Error procesando prompt ${i + 1}`);
            console.error(`Error procesando prompt ${i + 1}:`, error);
        }
    }

    if (imagenesProcesadas.length === 0) {
        throw new Error('No se pudo descargar ninguna imagen.');
    }

    return imagenesProcesadas;
}

async function ajustarDuracionMusicaFondo(backgroundMusicPath, duracionTotal, io) {
    const outputPath = path.join(__dirname, 'audio', 'background_adjusted.mp3');

    return new Promise((resolve, reject) => {
        io.emit('log', '🎵 Ajustando duración de la música de fondo...');
        ffmpeg()
            .input(backgroundMusicPath)
            .duration(duracionTotal)
            .output(outputPath)
            .on('end', () => {
                io.emit('log', '✅ Música de fondo ajustada');
                resolve(outputPath);
            })
            .on('error', (err) => {
                io.emit('log', '❌ Error ajustando la música de fondo');
                reject(err);
            })
            .run();
    });
}

function obtenerDuracionAudio(audioPath, io) {
    return new Promise((resolve, reject) => {
        io.emit('log', '⏳ Obteniendo duración del audio...');
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) {
                io.emit('log', '❌ Error obteniendo duración del audio');
                console.error('Error obteniendo duración del audio:', err);
                reject(err);
            } else {
                io.emit('log', `✅ Duración del audio: ${metadata.format.duration} segundos`);
                resolve(metadata.format.duration);
            }
        });
    });
}

async function generarVideo(imagenes, duracionTotal, io) {
    return new Promise(async (resolve, reject) => {
        try {
            if (!fs.existsSync(AUDIO_PATH)) {
                io.emit('log', `❌ No se encuentra el archivo de audio en: ${AUDIO_PATH}`);
                throw new Error(`❌ No se encuentra el archivo de audio en: ${AUDIO_PATH}`);
            }
            if (!fs.existsSync(BACKGROUND_MUSIC_PATH)) {
                io.emit('log', `❌ No se encuentra la música de fondo en: ${BACKGROUND_MUSIC_PATH}`);
                throw new Error(`❌ No se encuentra la música de fondo en: ${BACKGROUND_MUSIC_PATH}`);
            }

            // Función para generar un nombre único para el archivo de salida
            const generateUniqueFileName = (basePath) => {
                const dir = path.dirname(basePath);
                const ext = path.extname(basePath);
                const baseFileName = path.basename(basePath, ext);
                let counter = 1;
                let newPath = basePath;

                while (fs.existsSync(newPath)) {
                    newPath = path.join(dir, `${baseFileName}_${counter}${ext}`);
                    counter++;
                }

                return newPath;
            };

            // Generar un nombre único para el archivo de salida
            const videoOutput = generateUniqueFileName(path.join(__dirname, 'video_final.mp4'));

            // Ajustar la duración de la música de fondo
            const backgroundAdjusted = await ajustarDuracionMusicaFondo(BACKGROUND_MUSIC_PATH, duracionTotal, io);

            const duracionPorImagen = duracionTotal / imagenes.length;
            const listaImagenes = path.join(__dirname, 'imagenes.txt');

            // Crear archivo de lista para FFmpeg
            const contenidoLista = imagenes.map(img =>
                `file '${img.replace(/\\/g, '/')}'\nduration ${duracionPorImagen}`
            ).join('\n') + `\nfile '${imagenes[imagenes.length - 1].replace(/\\/g, '/')}'`;

            fs.writeFileSync(listaImagenes, contenidoLista);

            io.emit('log', '📝 Creando archivo de lista de imágenes...');

            const command = ffmpeg()
                .input(listaImagenes)
                .inputOptions(['-f concat', '-safe 0'])
                .input(AUDIO_PATH)
                .input(backgroundAdjusted)
                .complexFilter([
                    {
                        filter: 'volume',
                        options: { volume: 1.5 },
                        inputs: '1:a',
                        outputs: 'mainAudio'
                    },
                    {
                        filter: 'volume',
                        options: { volume: '-20dB' },
                        inputs: '2:a',
                        outputs: 'musicLowered'
                    },
                    {
                        filter: 'afade',
                        options: {
                            type: 'out',
                            duration: 0.4,
                            start_time: `${duracionTotal - 0.4}`
                        },
                        inputs: 'musicLowered',
                        outputs: 'musicFaded'
                    },
                    {
                        filter: 'amix',
                        options: {
                            inputs: 2,
                            duration: 'first'
                        },
                        inputs: ['mainAudio', 'musicFaded'],
                        outputs: 'finalAudio'
                    }
                ])
                .outputOptions([
                    '-r 30',
                    '-vsync cfr',
                    '-c:v libx264',
                    '-pix_fmt yuv420p',
                    '-c:a aac',
                    '-b:a 192k',
                    '-map 0:v',
                    '-map [finalAudio]',
                    '-shortest'
                ])
                .output(videoOutput);

            let lastProgress = 0;
            const EXPECTED_STEPS = 6;
            let currentStep = 0;

            command
                .on('start', () => io.emit('log', `🎬 Iniciando generación del video: ${path.basename(videoOutput)}`))
                .on('progress', progress => {
                    try {
                        const reportedPercent = parseFloat(progress.percent) || 0;

                        if (reportedPercent - lastProgress > 500) {
                            currentStep++;
                            lastProgress = reportedPercent;
                        }

                        const normalizedPercent = Math.min(100, (currentStep * 100) / EXPECTED_STEPS);

                        io.emit('log', `⏳ Procesando: ${normalizedPercent.toFixed(0)}%`);
                    } catch (error) {
                        console.error('Error procesando el progreso:', error);
                        io.emit('log', `⏳ Procesando...`);
                    }
                })
                .on('end', () => {
                    io.emit('log', `✅ Video generado exitosamente como: ${path.basename(videoOutput)}`);
                    fs.unlinkSync(backgroundAdjusted);
                    limpiarArchivosTemporales();
                    resolve(videoOutput);
                })
                .on('error', (err) => {
                    io.emit('log', '❌ Error generando el video');
                    console.error('❌ Error generando el video:', err);
                    reject(err);
                })
                .run();

        } catch (error) {
            io.emit('log', '❌ Error en la generación del video');
            reject(error);
        }
    });
}

async function main(script, io, options = {}) {
    const { orientation = 'horizontal', mediaType = 'image', inputPath } = options;
    io.emit('log', '🎬 Iniciando generación de video...');

    try {

        // Traducir el guion al inglés
        const scriptEnIngles = await traducirTexto(script, io);


        // 1. Dividir guion
        const shorts = dividirGuion(scriptEnIngles);
        io.emit('log', '📝 Guion dividido en partes');

        // 2. Generar prompts para imágenes
        const prompts = generarPrompts(shorts);

        // 3. Buscar y descargar imágenes
        const imagenes = await procesarImagenes(prompts, orientation, io);

        if (imagenes.length === 0) {
            io.emit('log', '❌ No se generaron imágenes. Abortando.');
            throw new Error('No se generaron imágenes.');
        }

        // 4. Obtener duración del audio principal
        const duracionTotal = await obtenerDuracionAudio(AUDIO_PATH, io);

        if (!duracionTotal) {
            io.emit('log', '❌ No se pudo obtener la duración del audio. Abortando.');
            throw new Error('No se pudo obtener la duración del audio.');
        }

        // 5. Generar video con imágenes y audio
        await generarVideo(imagenes, duracionTotal, io);
    } catch (error) {
        io.emit('log', `❌ Error en el proceso: ${error.message}`);
        console.error('Error en el proceso:', error);
        throw error;
    }
}

module.exports = { main };