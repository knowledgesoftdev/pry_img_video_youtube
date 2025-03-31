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

async function verificarArchivosNecesarios(videos, io) {
    // Verificar audio principal
    if (!fs.existsSync(AUDIO_PATH)) {
        throw new Error(`Audio principal no encontrado en: ${AUDIO_PATH}`);
    }
    io.emit('log', '✅ Audio principal encontrado');
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
        path.join(__dirname, 'videos_temporales.txt'),
        path.join(__dirname, 'videos_transiciones.txt'),

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

    // Limpiar carpeta de audio
    try {
        if (fs.existsSync(AUDIO_DIR)) {
            fs.readdirSync(AUDIO_DIR).forEach((archivo) => {
                const rutaCompleta = path.join(AUDIO_DIR, archivo);
                fs.unlinkSync(rutaCompleta);
                console.log(`🗑️ Archivo eliminado: ${rutaCompleta}`);
            });
        }
    } catch (error) {
        console.error(`❌ Error limpiando carpeta de audio:`, error);
    }
}

function dividirGuion(guion, maxSegmentos) {
    if (!guion || guion.trim().length === 0) {
        console.log('⚠️ El guion está vacío.');
        return [];
    }

    // Limpiar y normalizar el guion
    guion = guion.replace(/\s+/g, ' ').trim();

    // Estrategias de división más dinámicas
    const estrategiasDivision = [
        // División por párrafos completos con balance de longitud
        () => {
            const parrafos = guion.split(/\r?\n\r?\n+/)
                .filter(p => p.trim().length > 50);
            if (parrafos.length <= maxSegmentos) {
                return parrafos;
            }
            // Si hay muchos párrafos, dividirlos balanceadamente
            const segmentosReducidos = [];
            const tamañoGrupo = Math.ceil(parrafos.length / maxSegmentos);
            for (let i = 0; i < parrafos.length; i += tamañoGrupo) {
                const grupo = parrafos.slice(i, i + tamañoGrupo);
                segmentosReducidos.push(grupo.join(' '));
            }
            return segmentosReducidos.slice(0, maxSegmentos);
        },
        // División por oraciones con consideración de longitud
        () => {
            // Separar oraciones respetando abreviaturas y puntos
            const oraciones = guion.match(/[^.!?]+[.!?]+/g) || [];
            const oracionesFiltradas = oraciones.filter(o => o.trim().length > 50);
            if (oracionesFiltradas.length <= maxSegmentos) {
                return oracionesFiltradas;
            }
            // Agrupar oraciones para balancear longitud
            const segmentos = [];
            const longitudTotal = guion.length;
            const caracteresPromedio = Math.ceil(longitudTotal / maxSegmentos);
            let segmentoActual = '';
            for (const oracion of oracionesFiltradas) {
                if ((segmentoActual + oracion).length > caracteresPromedio * 1.5 ||
                    segmentos.length >= maxSegmentos - 1) {
                    segmentos.push(segmentoActual.trim());
                    segmentoActual = oracion;
                } else {
                    segmentoActual += ' ' + oracion;
                }
            }
            // Añadir el último segmento
            if (segmentoActual.trim()) {
                segmentos.push(segmentoActual.trim());
            }
            return segmentos.slice(0, maxSegmentos);
        },
        // División por longitud de caracteres con flexibilidad
        () => {
            const longitudTotal = guion.length;
            const caracteresPorSegmento = Math.ceil(longitudTotal / maxSegmentos);
            const segmentos = [];
            for (let i = 0; i < longitudTotal; i += caracteresPorSegmento) {
                let segmento = guion.substr(i, caracteresPorSegmento);
                // Buscar el último punto completo o palabra completa
                const ultimoPunto = segmento.lastIndexOf('.');
                const ultimapalabra = segmento.lastIndexOf(' ');
                if (ultimoPunto !== -1 && ultimoPunto > caracteresPorSegmento / 2) {
                    segmento = segmento.substr(0, ultimoPunto + 1);
                } else if (ultimapalabra !== -1) {
                    segmento = segmento.substr(0, ultimapalabra);
                }
                segmentos.push(segmento.trim());
            }
            return segmentos.filter(s => s.length > 50).slice(0, maxSegmentos);
        }
    ];

    // Probar estrategias de división
    let segmentos = [];
    for (const estrategia of estrategiasDivision) {
        segmentos = estrategia();
        if (segmentos.length > 1) break;
    }

    // Asegurar una cantidad mínima de segmentos
    if (segmentos.length < 2) {
        // Dividir por caracteres si no hay suficientes segmentos
        const longitudTotal = guion.length;
        const caracteresPorSegmento = Math.ceil(longitudTotal / maxSegmentos);
        segmentos = [];
        for (let i = 0; i < longitudTotal; i += caracteresPorSegmento) {
            segmentos.push(guion.substr(i, caracteresPorSegmento).trim());
        }
    }

    // Filtrar segmentos vacíos o muy cortos
    segmentos = segmentos
        .filter(s => s.trim().length > 50)
        .slice(0, maxSegmentos);

    console.log(`✅ Guion dividido en ${segmentos.length} partes`);
    return segmentos;
}

function generarPrompts(shorts) {
    if (!shorts || shorts.length === 0) {
        console.log('⚠️ No hay shorts para generar prompts.');
        return [];
    }

    // Definir categorías específicas para evitar personas y enfocarse en paisajes o superación
    const promptsPaisajes = [
        'Scenic landscape without people',
        'Breathtaking nature view',
        'Peaceful countryside scenery',
        'Mountain panorama with clouds',
        'Serene lake landscape at sunset',
        'Forest wilderness without humans',
        'Coastal scenery with waves',
        'Misty mountain range in morning',
        'Alpine landscape with snow',
        'Desert vista at golden hour'
    ];

    /*const promptsSuperacion = [
        'Motivational speech background',
        'Inspirational sunrise scene',
        'Success journey visualization',
        'Overcoming challenges illustration',
        'Path to victory symbolism'
    ];*/

    const promptsBox = [
        'Boxing training montage',
        'Boxer punching bag session',
        'Gym workout motivation',
        'Fighting spirit illustration',
        'Boxing ring atmosphere'
    ];

    const prompts = shorts.map((short, index) => {
        // Combinar extracto del guion con un prompt específico
        const palabrasClave = short.split(/\s+/).slice(0, 5).join(' '); // Tomar palabras clave del guion

        // Alternar entre categorías para diversificar
        let categoriaPrompt = '';
        if (index % 3 === 0) {
            categoriaPrompt = promptsPaisajes[index % promptsPaisajes.length];
        } else if (index % 3 === 1) {
            categoriaPrompt = promptsSuperacion[index % promptsSuperacion.length];
        } else {
            categoriaPrompt = promptsBox[index % promptsBox.length];
        }

        return `${categoriaPrompt} related to ${palabrasClave}`;
    });

    return prompts;
}

async function traducirTexto(texto, io) {
    try {
        io.emit('log', '🌍 Traduciendo guion al inglés...');
        const resultado = await translate.translate(texto, { to: 'en' });
        io.emit('log', '✅ Guion traducido exitosamente');
        return resultado.text;
    } catch (error) {
        io.emit('log', '⚠️ Error en la traducción del guion. Usando texto original.');
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

        // Filtrar videos que contengan personas o que no coincidan con la orientación
        const filteredVideos = data.videos.filter(video => {
            const { width, height, tags } = video.video_files[0];
            const isCorrectOrientation = orientation === 'vertical' ? height > width : width > height;
            const hasNoPeople = !tags.some(tag => tag.toLowerCase().includes('person') || tag.toLowerCase().includes('people'));
            return isCorrectOrientation && hasNoPeople;
        });

        if (filteredVideos.length === 0) {
            io.emit('log', `⚠️ No se encontraron videos adecuados para: ${prompt}`);
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

async function buscarVideosUnicos(prompt, orientation, videosDescargados, io) {
    try {
        io.emit('log', `🔍 Buscando video único para prompt: ${prompt}`);
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

        for (const video of filteredVideos) {
            const videoUrl = video.video_files[0].link;
            if (!videosDescargados.has(videoUrl)) {
                videosDescargados.add(videoUrl);
                io.emit('log', `✅ Video único encontrado: ${videoUrl}`);
                return videoUrl;
            }
        }

        io.emit('log', `⚠️ No se encontraron videos únicos para: ${prompt}`);
        return null;
    } catch (error) {
        io.emit('log', `❌ Error buscando video único para prompt: ${prompt}`);
        console.error(error);
        return null;
    }
}

async function buscarYDescargarVideosParaSegmento(prompt, orientation, duracionRequerida, videosDescargados, io) {
    const videosDescargadosEnEsteSegmento = [];
    let duracionAcumulada = 0;

    while (duracionAcumulada < duracionRequerida) {
        try {
            const videoUrl = await buscarVideosUnicos(prompt, orientation, videosDescargados, io);
            if (!videoUrl) {
                io.emit('log', `⚠️ No se encontró más videos para el segmento. Duración acumulada: ${duracionAcumulada}s`);
                break;
            }

            const nombreArchivo = `segment_${videosDescargadosEnEsteSegmento.length + 1}.mp4`;
            const rutaVideo = await descargarVideo(videoUrl, nombreArchivo, orientation, io);

            const duracionVideo = (await obtenerDuracionVideo(rutaVideo)).duration;
            duracionAcumulada += duracionVideo;
            videosDescargadosEnEsteSegmento.push(rutaVideo);

            io.emit('log', `✅ Video descargado (${duracionVideo}s). Duración acumulada: ${duracionAcumulada}s`);
        } catch (error) {
            io.emit('log', `⚠️ Error buscando o descargando video: ${error.message}`);
            break;
        }
    }

    return videosDescargadosEnEsteSegmento;
}

async function concatenarVideosCortos(videos, duracionRequerida, io) {
    const listaVideosConTransiciones = path.join(__dirname, 'videos_temporales.txt');
    const contenidoLista = videos.map(video => `file '${video.replace(/\\/g, '/')}'`).join('\n');

    fs.writeFileSync(listaVideosConTransiciones, contenidoLista);

    const outputPath = path.join(VIDEOS_DIR, `concatenated_segment_${Date.now()}.mp4`);

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(listaVideosConTransiciones)
            .inputOptions(['-f', 'concat', '-safe', '0'])
            .outputOptions(['-t', duracionRequerida])
            .on('end', () => {
                io.emit('log', `✅ Videos concatenados exitosamente: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                io.emit('log', `❌ Error concatenando videos: ${err.message}`);
                reject(err);
            })
            .save(outputPath);
    });
}

async function procesarVideos(prompts, orientation, io) {
    const videosProcesados = [];
    const videosDescargados = new Set(); // Conjunto para rastrear videos descargados
    const duracionTotal = await obtenerDuracionAudio(AUDIO_PATH, io);
    const duracionPorSegmento = duracionTotal / prompts.length;
    let duracionAcumulada = 0;

    for (let i = 0; i < prompts.length; i++) {
        try {
            const prompt = prompts[i];
            io.emit('log', `🔍 Procesando segmento ${i + 1}/${prompts.length} (${duracionPorSegmento.toFixed(2)}s)`);

            // Buscar y descargar videos para este segmento
            const videosSegmento = await buscarYDescargarVideosParaSegmento(prompt, orientation, duracionPorSegmento, videosDescargados, io);

            if (videosSegmento.length === 0) {
                io.emit('log', `⚠️ No se encontraron videos adecuados para el segmento ${i + 1}. Saltando...`);
                continue;
            }

            // Concatenar videos si hay múltiples
            const videoConcatenado = await concatenarVideosCortos(videosSegmento, duracionPorSegmento, io);

            // Ajustar la duración final del video concatenado
            const videoAjustado = await ajustarDuracionVideo(videoConcatenado, duracionPorSegmento, io);

            // Verificar la duración del video final
            await verificarDuracionVideo(videoAjustado, duracionPorSegmento);

            videosProcesados.push(videoAjustado);
            duracionAcumulada += duracionPorSegmento;
            io.emit('log', `✅ Segmento ${i + 1} completado con éxito.`);
        } catch (error) {
            io.emit('log', `❌ Error procesando segmento ${i + 1}: ${error.message}`);
            console.error(error);
        }
    }

    if (videosProcesados.length === 0) {
        throw new Error('No se generaron videos.');
    }

    io.emit('log', `✅ Procesados ${videosProcesados.length} segmentos.`);
    return videosProcesados;
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
        io.emit('log', `📐 Redimensionando video: ${inputPath}`);
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

async function verificarDuracionVideo(videoPath, duracionRequerida) {
    const metadata = await obtenerDuracionVideo(videoPath);
    if (Math.abs(metadata.duration - duracionRequerida) > 1) {
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

async function obtenerDuracionAudio(audioPath, io) {
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
        io.emit('log', `✂️ Ajustando duración del video: ${inputPath} a ${duracionRequerida}s`);
        ffmpeg(inputPath)
            .outputOptions('-t', duracionRequerida)
            .on('end', async () => {
                const metadata = await obtenerDuracionVideo(outputPath);
                if (Math.abs(metadata.duration - duracionRequerida) > 1) {
                    io.emit('log', `⚠️ La duración ajustada (${metadata.duration}s) no coincide con la requerida (${duracionRequerida}s). Continuando...`);
                }
                resolve(outputPath);
            })
            .on('error', (err) => {
                io.emit('log', `❌ Error ajustando duración del video: ${inputPath}`);
                reject(err);
            })
            .save(outputPath);
    });
}

async function validarArchivos(videos, audioPath, io) {
    for (const video of videos) {
        if (!fs.existsSync(video)) {
            throw new Error(`Video no encontrado: ${video}`);
        }
        const metadata = await obtenerDuracionVideo(video);
        if (metadata.duration <= 0) {
            throw new Error(`Video inválido o sin duración: ${video}`);
        }
    }

    if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio no encontrado: ${audioPath}`);
    }
    const audioMetadata = await obtenerDuracionAudio(audioPath, io);
    if (audioMetadata <= 0) {
        throw new Error(`Audio inválido o sin duración: ${audioPath}`);
    }
}

async function generarVideo(videos, duracionTotal, io) {
    return new Promise(async (resolve, reject) => {
        try {
            // Validar archivos de entrada
            await validarArchivos(videos, AUDIO_PATH, io);

            // Crear archivo de lista para FFmpeg
            const listaVideosConTransiciones = path.join(__dirname, 'videos_transiciones.txt');
            const contenidoLista = videos.map(video => `file '${video.replace(/\\/g, '/')}'`).join('\n');
            fs.writeFileSync(listaVideosConTransiciones, contenidoLista, 'utf8');

            io.emit('log', 'Contenido del archivo de lista con transiciones:');
            io.emit('log', contenidoLista);

            const videoOutput = path.join(OUTPUT_DIR, 'video_final.mp4');
            const duracionTransicion = Math.min(0.5, duracionTotal / 2); // Limitar la duración de la transición

            // Comando de FFmpeg simplificado
            const command = ffmpeg()
                .input(listaVideosConTransiciones)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .input(AUDIO_PATH)
                .videoFilters([
                    {
                        filter: 'fade',
                        options: {
                            type: 'in',
                            start_time: 0,
                            duration: duracionTransicion
                        }
                    },
                    {
                        filter: 'fade',
                        options: {
                            type: 'out',
                            start_time: duracionTotal - duracionTransicion,
                            duration: duracionTransicion
                        }
                    }
                ])
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-map', '0:v',
                    '-map', '1:a',
                    '-shortest'
                ])
                .output(videoOutput);

            // Manejo de eventos de FFmpeg
            command
                .on('start', (commandLine) => {
                    io.emit('log', `🎥 Comando FFmpeg: ${commandLine}`);
                })
                .on('progress', (progress) => {
                    try {
                        const reportedPercent = parseFloat(progress.percent) || 0;
                        const normalizedPercent = Math.min(100, Math.max(0, reportedPercent));
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
                            io.emit('log', `⚠️ La duración del video final (${metadataFinal.duration}s) no coincide con la requerida (${duracionTotal}s). Continuando...`);
                        }
                        io.emit('log', `✅ Duración del video final verificada: ${metadataFinal.duration}s`);
                        
                        // Limpiar archivos temporales
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

async function mainVideosLargos(script, io, options = {}) {
    const {
        orientation = 'horizontal',
        maxSegmentos = 20
    } = options;

    io.emit('log', '🎬 Iniciando generación de videos para guion largo...');
    try {
        // Crear directorios necesarios si no existen
        [OUTPUT_DIR, VIDEOS_DIR, AUDIO_DIR, UPLOADS_DIR].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });

        // Traducir el guion al inglés
        const scriptEnIngles = await traducirTexto(script, io);

        // Obtener duración del audio principal
        const duracionTotal = await obtenerDuracionAudio(AUDIO_PATH, io);
        if (!duracionTotal) {
            io.emit('log', '❌ No se pudo obtener la duración del audio. Abortando.');
            throw new Error('No se pudo obtener la duración del audio.');
        }

        // Cálculo dinámico de segmentos
        const duracionPromedio = duracionTotal / 10; // Dividir en aproximadamente 10 segmentos
        const segmentosFinales = Math.max(
            2,
            Math.min(
                Math.ceil(duracionTotal / duracionPromedio),
                maxSegmentos
            )
        );

        io.emit('log', `📝 Detalles de segmentación:`);
        io.emit('log', `   - Duración total del audio: ${duracionTotal}s`);
        io.emit('log', `   - Número de segmentos calculados: ${segmentosFinales}`);
        io.emit('log', `   - Duración promedio por segmento: ${(duracionTotal / segmentosFinales).toFixed(2)}s`);

        // Dividir guion con límite de segmentos dinámico
        const shorts = dividirGuion(scriptEnIngles, segmentosFinales);
        if (!shorts || shorts.length === 0) {
            throw new Error('No se pudo dividir el guion.');
        }

        io.emit('log', `📚 Guion dividido en ${shorts.length} partes`);

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

        // Generar video con videos y audio
        const videoFinal = await generarVideo(videosProcesados, duracionTotal, io);
        return videoFinal;
    } catch (error) {
        io.emit('log', `❌ Error en el proceso: ${error.message}`);
        console.error('Error en el proceso:', error);
        throw error;
    }
}

module.exports = { mainVideosLargos };