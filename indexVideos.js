const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const translate = require('@vitalets/google-translate-api');

// Configuración de directorios
const OUTPUT_DIR = path.join(__dirname, 'output');
const VIDEOS_DIR = path.join(__dirname, 'videos');
const AUDIO_DIR = path.join(__dirname, 'audio');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Asegurar que las carpetas necesarias existen
[OUTPUT_DIR, VIDEOS_DIR, AUDIO_DIR, UPLOADS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Set FFmpeg paths
const ffmpegPath = 'C:/ffmpeg/bin/ffmpeg.exe';
const ffprobePath = 'C:/ffmpeg/bin/ffprobe.exe';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const PEXELS_API_KEY = 'YvvUFoxGmsUnT8lvRw2TuErgbYPy3skervQFsmrSIOSkYegbx3mdnjrU';
const PEXELS_API_URL = 'https://api.pexels.com/v1/videos/search';
const AUDIO_PATH = path.join(AUDIO_DIR, 'voice.mp3');
const BACKGROUND_MUSIC_PATH = path.join(AUDIO_DIR, 'background.mp3');

async function verificarArchivosNecesarios(videos, io) {
    // Verificar audio principal
    if (!fs.existsSync(AUDIO_PATH)) {
        throw new Error(`Audio principal no encontrado en: ${AUDIO_PATH}`);
    }
    io.emit('log', '✅ Audio principal encontrado');

    // Verificar música de fondo
    if (!fs.existsSync(BACKGROUND_MUSIC_PATH)) {
        throw new Error(`Música de fondo no encontrada en: ${BACKGROUND_MUSIC_PATH}`);
    }
    io.emit('log', '✅ Música de fondo encontrada');

    // Verificar videos
    for (const video of videos) {
        if (!fs.existsSync(video)) {
            throw new Error(`Video no encontrado: ${video}`);
        }
        const metadata = await obtenerDuracionVideo(video);
        io.emit('log', `✅ Video verificado: ${video} (${metadata.duration}s)`);
    }
}

function limpiarArchivosTemporales() {
    const carpetasALimpiar = [
        VIDEOS_DIR,
        UPLOADS_DIR,
    ];

    const archivosAEliminar = [
        path.join(__dirname, 'videos.txt'),
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

    // Limpiar carpetas
    carpetasALimpiar.forEach((carpeta) => {
        try {
            if (fs.existsSync(carpeta)) {
                fs.readdirSync(carpeta).forEach((archivo) => {
                    const rutaCompleta = path.join(carpeta, archivo);
                    fs.unlinkSync(rutaCompleta);
                    console.log(`🗑️ Archivo eliminado: ${rutaCompleta}`);
                });
            }
        } catch (error) {
            console.error(`❌ Error limpiando carpeta ${carpeta}:`, error);
        }
    });

    // Limpiar carpeta de audio, excepto background.mp3
    try {
        if (fs.existsSync(AUDIO_DIR)) {
            fs.readdirSync(AUDIO_DIR).forEach((archivo) => {
                if (archivo !== 'background.mp3') {
                    const rutaCompleta = path.join(AUDIO_DIR, archivo);
                    fs.unlinkSync(rutaCompleta);
                    console.log(`🗑️ Archivo eliminado: ${rutaCompleta}`);
                }
            });
        }
    } catch (error) {
        console.error(`❌ Error limpiando carpeta de audio:`, error);
    }
}

function dividirGuion(guion) {
    if (!guion || guion.trim().length === 0) {
        console.log('⚠️ El guion está vacío.');
        return [];
    }
    const partes = guion.split(/(?:\r?\n\r?\n+|\. )/);
    return partes.filter(parte => parte.trim().length > 0).slice(0, 8);
}

function generarPrompts(shorts) {
    if (!shorts || shorts.length === 0) {
        io.emit('log', '⚠️ No hay shorts para generar prompts.');
        return [];
    }
    const prompts = shorts.map(short => `Video inspirado en: ${short.trim().slice(0, 100)}...`);
    return prompts;
}

async function traducirTexto(texto, io) {
    try {
        io.emit('log', '🌐 Traduciendo guion al inglés...');
        const resultado = await translate.translate(texto, { to: 'en' });
        io.emit('log', '✅ Guion traducido exitosamente');
        return resultado.text;
    } catch (error) {
        io.emit('log', '❌ Error en la traducción del guion. Usando texto original.');
        console.error('Error en la traducción:', error);
        return texto; // Devuelve el texto original como respaldo
    }
}

async function buscarVideos(prompt, orientation, io) {
    try {
        io.emit('log', `🔍 Buscando video para prompt: ${prompt}`);
        const response = await fetch(`${PEXELS_API_URL}?query=${encodeURIComponent(prompt)}&per_page=100`, {
            headers: { Authorization: PEXELS_API_KEY }
        });

        if (!response.ok) {
            throw new Error(`Error en la respuesta de la API: ${response.statusText}`);
        }

        const data = await response.json();
        const filteredVideos = data.videos.filter(video => {
            const { width, height } = video.video_files[0];
            if (orientation === 'vertical') {
                return height > width;
            } else {
                return width > height;
            }
        });

        if (filteredVideos.length === 0) {
            io.emit('log', `⚠️ No se encontraron videos para: ${prompt}`);
            return null;
        }

        const videoUrl = filteredVideos[0].video_files[0].link;
        io.emit('log', `✅ Video encontrado: ${videoUrl}`);
        return videoUrl;
    } catch (error) {
        io.emit('log', `❌ Error buscando video para prompt: ${prompt}`);
        console.error(error);
        return null;
    }
}

async function descargarVideo(url, nombreArchivo, orientation, io) {
    try {
        io.emit('log', `📥 Descargando video: ${nombreArchivo}`);
        const response = await fetch(url);
        const buffer = await response.buffer();
        const filePath = path.join(VIDEOS_DIR, nombreArchivo);

        fs.writeFileSync(filePath, buffer);
        const outputPath = path.join(VIDEOS_DIR, nombreArchivo.replace('.mp4', '_resized.mp4'));
        await redimensionarVideo(filePath, outputPath, orientation, io);

        fs.unlinkSync(filePath);
        io.emit('log', `✅ Video descargado y redimensionado: ${outputPath}`);
        return outputPath;
    } catch (error) {
        io.emit('log', `❌ Error descargando video: ${nombreArchivo}`);
        console.error(error);
        throw error;
    }
}

function redimensionarVideo(inputPath, outputPath, orientation, io) {
    return new Promise((resolve, reject) => {
        const scale = orientation === 'vertical' ? 'scale=1080:1920' : 'scale=1920:1080';
        io.emit('log', `🔄 Redimensionando video: ${inputPath}`);
        ffmpeg(inputPath)
            .outputOptions('-vf', `${scale},fps=30`) // Asegura una tasa de fotogramas de 30 fps
            .outputOptions('-an') // Eliminar el audio para evitar problemas
            .on('end', async () => {
                io.emit('log', `✅ Video redimensionado: ${outputPath}`);
                const metadata = await obtenerDuracionVideo(outputPath);
                io.emit('log', `📊 Duración del video redimensionado: ${metadata.duration}s`);
                resolve();
            })
            .on('error', (err) => {
                io.emit('log', `❌ Error redimensionando video: ${inputPath}`);
                reject(err);
            })
            .save(outputPath);
    });
}

async function normalizarVideos(videos, io) {
    const videosNormalizados = [];
    for (const video of videos) {
        const outputPath = video.replace('.mp4', '_normalized.mp4');
        await new Promise((resolve, reject) => {
            ffmpeg(video)
                .outputOptions('-vf', 'scale=1920:1080,fps=30')
                .outputOptions('-c:v', 'libx264')
                .outputOptions('-preset', 'medium')
                .outputOptions('-crf', '23')
                .on('end', () => {
                    io.emit('log', `✅ Video normalizado: ${outputPath}`);
                    videosNormalizados.push(outputPath);
                    resolve();
                })
                .on('error', (err) => {
                    io.emit('log', `❌ Error normalizando video: ${video}`);
                    reject(err);
                })
                .save(outputPath);
        });
    }
    return videosNormalizados;
}


async function procesarVideos(prompts, orientation, io) {
    const videosProcesados = [];
    const duracionTotal = await obtenerDuracionAudio(AUDIO_PATH, io);
    const duracionPorVideo = duracionTotal / prompts.length;
    let duracionAcumulada = 0;

    for (let i = 0; i < prompts.length; i++) {
        try {
            const prompt = prompts[i].replace("Video para Short ", "");
            io.emit('log', `🔍 Buscando video para prompt: ${prompt}`);
            let videoUrl = await buscarVideos(prompt, orientation, io);

            if (!videoUrl) {
                io.emit('log', `⚠️ No se encontró video para: ${prompt}. Buscando alternativa...`);
                videoUrl = await buscarVideoAlternativo(prompt, orientation, io);
                if (!videoUrl) {
                    io.emit('log', `❌ No se encontró video adecuado para: ${prompt}. Omitiendo...`);
                    continue;
                }
            }

            const nombreArchivo = `short_${i + 1}.mp4`;
            const rutaVideo = await descargarVideo(videoUrl, nombreArchivo, orientation, io);
            const videoAjustado = await ajustarDuracionVideo(rutaVideo, duracionPorVideo, io);
            await verificarDuracionVideo(videoAjustado, duracionPorVideo);

            videosProcesados.push(videoAjustado);
            duracionAcumulada += duracionPorVideo;
        } catch (error) {
            io.emit('log', `❌ Error procesando prompt ${i + 1}: ${error.message}`);
            console.error(error);
        }
    }

    // Verificar si la duración acumulada coincide con la duración total
    if (duracionAcumulada < duracionTotal) {
        io.emit('log', `⚠️ Duración acumulada (${duracionAcumulada}s) menor que la requerida (${duracionTotal}s). Ajustando...`);
        const tiempoFaltante = duracionTotal - duracionAcumulada;
        const tiempoPorVideo = tiempoFaltante / videosProcesados.length;

        for (const video of videosProcesados) {
            const nuevaDuracion = (await obtenerDuracionVideo(video)).duration + tiempoPorVideo;
            await ajustarDuracionVideo(video, nuevaDuracion, io);
        }
    }

    if (videosProcesados.length === 0) {
        throw new Error('No se pudo descargar ningún video.');
    }

    io.emit('log', `✅ Procesados ${videosProcesados.length} videos.`);
    return videosProcesados;
}



async function verificarDuracionVideo(videoPath, duracionRequerida) {
    const metadata = await obtenerDuracionVideo(videoPath);
    if (Math.abs(metadata.duration - duracionRequerida) > 0.1) {
        throw new Error(`La duración del video (${metadata.duration}s) no coincide con la requerida (${duracionRequerida}s).`);
    }
}

async function obtenerDuracionVideo(url) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(url, (err, metadata) => {
            if (err) {
                reject(err);
                return;
            }
            resolve({
                duration: metadata.format.duration,
                width: metadata.streams[0].width,
                height: metadata.streams[0].height
            });
        });
    });
}

async function buscarVideoAlternativo(prompt, orientation, io, index = 1) {
    try {
        const response = await fetch(`${PEXELS_API_URL}?query=${encodeURIComponent(prompt)}&per_page=100`, {
            headers: { Authorization: PEXELS_API_KEY }
        });

        if (!response.ok) {
            throw new Error(`Error en la respuesta de la API: ${response.statusText}`);
        }

        const data = await response.json();
        const filteredVideos = data.videos.filter(video => {
            const { width, height } = video.video_files[0];
            return orientation === 'vertical' ? height > width : width > height;
        });

        if (filteredVideos.length > index) {
            return filteredVideos[index].video_files[0].link;
        }
        return null;
    } catch (error) {
        io.emit('log', `❌ Error buscando video alternativo para prompt: ${prompt}`);
        return null;
    }
}

async function ajustarDuracionMusicaFondo(backgroundMusicPath, duracionTotal, io) {
    const outputPath = path.join(AUDIO_DIR, 'background_adjusted.mp3');
    return new Promise((resolve, reject) => {
        io.emit('log', `🎵 Ajustando duración de la música de fondo a ${duracionTotal}s...`);
        ffmpeg()
            .input(backgroundMusicPath)
            .duration(duracionTotal)
            .output(outputPath)
            .on('end', async () => {
                io.emit('log', '✅ Música de fondo ajustada');
                const metadata = await obtenerDuracionAudio(outputPath);
                io.emit('log', `📊 Duración de la música de fondo ajustada: ${metadata.duration}s`);
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
        if (io) io.emit('log', '⏳ Obteniendo duración del audio...');
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) {
                if (io) io.emit('log', '❌ Error obteniendo duración del audio');
                reject(err);
            } else {
                if (io) io.emit('log', `✅ Duración del audio: ${metadata.format.duration} segundos`);
                resolve(metadata.format.duration);
            }
        });
    });
}

async function ajustarDuracionVideo(inputPath, duracionRequerida, io) {
    const outputPath = inputPath.replace('.mp4', '_adjusted.mp4');
    return new Promise((resolve, reject) => {
        io.emit('log', `🔄 Ajustando duración del video: ${inputPath} a ${duracionRequerida}s`);
        ffmpeg(inputPath)
            .outputOptions('-t', duracionRequerida)
            .on('end', async () => {
                io.emit('log', `✅ Video ajustado: ${outputPath}`);
                const metadata = await obtenerDuracionVideo(outputPath);
                if (Math.abs(metadata.duration - duracionRequerida) > 0.1) {
                    io.emit('log', `⚠️ La duración ajustada (${metadata.duration}s) no coincide con la requerida (${duracionRequerida}s). Reintentando...`);
                    reject(new Error(`La duración ajustada no coincide.`));
                } else {
                    io.emit('log', `📊 Duración del video ajustado: ${metadata.duration}s`);
                    resolve(outputPath);
                }
            })
            .on('error', (err) => {
                io.emit('log', `❌ Error ajustando duración del video: ${inputPath}`);
                reject(err);
            })
            .save(outputPath);
    });
}

async function generarVideo(videos, duracionTotal, io) {
    return new Promise(async (resolve, reject) => {
        try {
            // Verificar duración total
            io.emit('log', `📊 Duración total esperada: ${duracionTotal} segundos`);

            // Verificar que los videos existen y obtener sus duraciones
            const videosConDuracion = [];
            for (const video of videos) {
                if (!fs.existsSync(video)) {
                    throw new Error(`Video no encontrado: ${video}`);
                }
                const metadata = await obtenerDuracionVideo(video);
                io.emit('log', `📊 Duración del video ${video}: ${metadata.duration} segundos`);
                videosConDuracion.push({ path: video, duration: metadata.duration });
            }

            // Verificar archivos de audio
            if (!fs.existsSync(AUDIO_PATH)) {
                throw new Error(`No se encuentra el archivo de audio en: ${AUDIO_PATH}`);
            }
            if (!fs.existsSync(BACKGROUND_MUSIC_PATH)) {
                throw new Error(`No se encuentra la música de fondo en: ${BACKGROUND_MUSIC_PATH}`);
            }

            // Ajustar la duración de la música de fondo
            const backgroundAdjusted = await ajustarDuracionMusicaFondo(BACKGROUND_MUSIC_PATH, duracionTotal, io);

            const videoOutput = path.join(OUTPUT_DIR, 'video_final.mp4');
            const listaVideos = path.join(__dirname, 'videos.txt');

            // Crear archivo de lista para FFmpeg con duraciones
            const contenidoLista = videosConDuracion.map(video =>
                `file '${video.path.replace(/\\/g, '/')}'\nduration ${video.duration}`
            ).join('\n') + `\nfile '${videosConDuracion[videosConDuracion.length - 1].path.replace(/\\/g, '/')}'`;

            fs.writeFileSync(listaVideos, contenidoLista);
            io.emit('log', '📄 Contenido del archivo de lista:');
            io.emit('log', contenidoLista);

            const command = ffmpeg()
                .input(listaVideos)
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
                    '-y', // Sobrescribir archivo si existe
                    '-c:v libx264',
                    '-preset medium',
                    '-crf 23',
                    '-movflags +faststart',
                    '-pix_fmt yuv420p',
                    '-max_muxing_queue_size 1024',
                    '-map 0:v',
                    '-map [finalAudio]',
                    '-shortest'
                ])
                .output(videoOutput);

            command
                .on('start', (commandLine) => {
                    io.emit('log', `🎬 Comando FFmpeg: ${commandLine}`);
                })
                .on('progress', (progress) => {
                    try {
                        // Extraer el porcentaje reportado por FFmpeg
                        const reportedPercent = parseFloat(progress.percent) || 0;

                        // Normalizar el progreso al rango de 0% a 100%
                        const normalizedPercent = Math.min(100, Math.max(0, reportedPercent));

                        // Emitir el progreso normalizado
                        io.emit('log', `⏳ Progreso: ${normalizedPercent.toFixed(0)}%`);
                    } catch (error) {
                        console.error('Error procesando el progreso:', error);
                        io.emit('log', `⏳ Procesando...`);
                    }
                })
                .on('end', async () => {
                    try {
                        io.emit('log', '✅ Video generado exitosamente');

                        // Validar la duración del video final
                        const metadataFinal = await obtenerDuracionVideo(videoOutput);
                        if (Math.abs(metadataFinal.duration - duracionTotal) > 0.5) {
                            throw new Error(`La duración del video final (${metadataFinal.duration}s) no coincide con la requerida (${duracionTotal}s).`);
                        }
                        io.emit('log', `✅ Duración del video final verificada: ${metadataFinal.duration}s`);

                        // Limpiar archivos temporales
                        fs.unlinkSync(backgroundAdjusted);
                        limpiarArchivosTemporales();

                        resolve(videoOutput);
                    } catch (error) {
                        io.emit('log', `❌ Error validando el video final: ${error.message}`);
                        reject(error);
                    }
                })
                .on('error', (err) => {
                    io.emit('log', '❌ Error generando el video');
                    console.error('Error generando el video:', err);
                    reject(err);
                })
                .run();
        } catch (error) {
            io.emit('log', '❌ Error en la generación del video');
            reject(error);
        }
    });
}
async function mainVideos(script, io, options = {}) {
    const { orientation = 'horizontal' } = options;
    io.emit('log', '🎬 Iniciando generación de videos...');
    try {
        // Crear directorios necesarios si no existen
        [OUTPUT_DIR, VIDEOS_DIR, AUDIO_DIR, UPLOADS_DIR].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });

        // Traducir el guion al inglés
        const scriptEnIngles = await traducirTexto(script, io);

        // Dividir guion
        const shorts = dividirGuion(scriptEnIngles);
        if (!shorts || shorts.length === 0) {
            throw new Error('No se pudo dividir el guion.');
        }
        io.emit('log', '📝 Guion dividido en partes');

        // Generar prompts para videos
        const prompts = generarPrompts(shorts);
        if (!prompts || prompts.length === 0) {
            io.emit('log', '❌ No se pudieron generar prompts. Abortando.');
            throw new Error('No se pudieron generar prompts.');
        }

        // Buscar y descargar videos
        const videosProcesados = await procesarVideos(prompts, orientation, io);
        if (!videosProcesados || videosProcesados.length === 0) {
            io.emit('log', '❌ No se generaron videos. Abortando.');
            throw new Error('No se generaron videos.');
        }

        // Verificar archivos necesarios
        await verificarArchivosNecesarios(videosProcesados, io);

        // Obtener duración del audio principal
        const duracionTotal = await obtenerDuracionAudio(AUDIO_PATH, io);
        if (!duracionTotal) {
            io.emit('log', '❌ No se pudo obtener la duración del audio. Abortando.');
            throw new Error('No se pudo obtener la duración del audio.');
        }

        // Generar video con videos y audio
        await generarVideo(videosProcesados, duracionTotal, io);
    } catch (error) {
        io.emit('log', `❌ Error en el proceso: ${error.message}`);
        console.error('Error en el proceso:', error);
        throw error;
    }
}

module.exports = { mainVideos };