const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ===== LOGGING =====
function logInfo(message, data) {
  console.log(`[${new Date().toISOString()}] [INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function logError(message, error) {
  console.error(`[${new Date().toISOString()}] [ERROR] ${message}`, error || '');
}

function logWarning(message, data) {
  console.warn(`[${new Date().toISOString()}] [WARNING] ${message}`, data || '');
}

// ===== SUPABASE SETUP =====
let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    logInfo('✓ تم الاتصال بـ Supabase بنجاح');
  } else {
    logWarning('متغيرات بيئة Supabase غير متوفرة - سيتم تخطي التحميل التلقائي');
  }
} catch (error) {
  logError('فشل الاتصال بـ Supabase', error);
}

// ===== JOB STORAGE =====
const activeJobs = {};
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const TEMP_DIR = path.join(__dirname, 'temp');

// Create directories if they don't exist
[OUTPUT_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logInfo(`تم إنشاء المجلد: ${dir}`);
  }
});

// ===== HELPERS =====

function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  return url.trim();
}

// يقبل array أو string أو JSON-string أو comma-separated ويحوّله لقائمة
function normalizeToArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];

  const v = value.trim();
  if (!v) return [];

  // JSON array string
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // comma-separated list
  if (v.includes(',')) return v.split(',').map(s => s.trim()).filter(Boolean);

  return [v];
}

function uniqCompact(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const s = sanitizeUrl(typeof item === 'string' ? item : String(item ?? ''));
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function validateUrls(imageUrl, audioUrl) {
  const errors = [];
  
  if (!imageUrl) {
    errors.push('imageUrl مطلوب');
  } else if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
    errors.push('imageUrl يجب أن يبدأ بـ http:// أو https://');
  }
  
  if (!audioUrl) {
    errors.push('audioUrl مطلوب');
  } else if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
    errors.push('audioUrl يجب أن يبدأ بـ http:// أو https://');
  }
  
  return errors;
}

/**
 * Download a file from URL to local temp directory
 * This helps FFmpeg handle files better, especially from APIs
 */
function isSupabaseUrl(url) {
  try { return new URL(url).hostname.includes('supabase.co'); } catch { return false; }
}

async function downloadFile(url, jobId, fileType) {
  let extension = '.jpg';
  if (fileType === 'audio') extension = '.mp3';
  else if (url.includes('.png')) extension = '.png';
  else if (url.includes('.webp')) extension = '.webp';
  else if (url.includes('.wav')) extension = '.wav';

  const tempFilePath = path.join(TEMP_DIR, `${jobId}_${fileType}${extension}`);
  logInfo(`[SERVER-DOWNLOAD] تحميل ${fileType}`, { url: url.substring(0, 120) });

  const isSupabase = isSupabaseUrl(url);
  const supabaseKey = process.env.SUPABASE_KEY || '';
  const attempts = [
    ...(isSupabase && supabaseKey ? [{
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    }] : []),
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': fileType === 'audio' ? 'audio/*,*/*' : 'image/*,*/*' } },
    { headers: {} }
  ];

  let lastError = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const response = await fetch(url, { headers: attempts[i].headers, signal: controller.signal, redirect: 'follow' });
      clearTimeout(timeout);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        lastError = new Error(`[SERVER-DOWNLOAD] HTTP ${response.status} عند تحميل ${fileType} من ${new URL(url).hostname} | ${body.slice(0, 200)}`);
        logError(lastError.message);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) { lastError = new Error(`[SERVER-DOWNLOAD] ملف ${fileType} فارغ`); continue; }
      fs.writeFileSync(tempFilePath, buffer);
      logInfo(`[SERVER-DOWNLOAD] ✅ تم تحميل ${fileType} (${buffer.length} bytes)`);
      return tempFilePath;
    } catch (err) {
      lastError = new Error(err.name === 'AbortError' ? `[SERVER-DOWNLOAD] انتهت مهلة تحميل ${fileType}` : `[SERVER-DOWNLOAD] ${err.message}`);
      logError(lastError.message);
    }
  }
  throw lastError || new Error(`[SERVER-DOWNLOAD] فشل تحميل ${fileType}`);
}

/**
 * Clean up temporary files
 */
function cleanupTempFiles(jobId) {
  const tempFiles = [
    path.join(TEMP_DIR, `${jobId}_image.jpg`),
    path.join(TEMP_DIR, `${jobId}_image.png`),
    path.join(TEMP_DIR, `${jobId}_audio.mp3`),
    path.join(TEMP_DIR, `${jobId}_audio.wav`),
  ];
  
  tempFiles.forEach(file => {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
        logInfo(`تم حذف الملف المؤقت: ${file}`);
      } catch (err) {
        logWarning(`فشل حذف الملف المؤقت: ${file}`, err);
      }
    }
  });
}

async function uploadToSupabase(jobId, filePath) {
  if (!supabase) {
    logWarning('لا يمكن التحميل إلى Supabase - الاتصال غير متوفر', { jobId });
    return null;
  }

  try {
    const fileContent = fs.readFileSync(filePath);
    const fileName = `${jobId}.mp4`;
    
    logInfo('بدء التحميل إلى Supabase', { jobId, fileName, size: fileContent.length });
    
    const { error: uploadError } = await supabase.storage
      .from('videos')
      .upload(`public/${fileName}`, fileContent, {
        contentType: 'video/mp4',
        upsert: true
      });
    
    if (uploadError) {
      throw uploadError;
    }
    
    const { data: publicUrlData } = supabase.storage
      .from('videos')
      .getPublicUrl(`public/${fileName}`);
    
    logInfo('✓ تم التحميل إلى Supabase بنجاح', { publicUrl: publicUrlData.publicUrl });
    return publicUrlData.publicUrl;
  } catch (error) {
    logError('فشل التحميل إلى Supabase', error);
    return null;
  }
}

function getJobOutputPath(jobId) {
  return path.join(OUTPUT_DIR, `${jobId}.mp4`);
}

// ===== FFMPEG PROCESSING =====

// احصل على مدة الصوت بالثواني
async function getAudioDuration(audioPath) {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath
    ]);
    let output = '';
    ffprobe.stdout.on('data', d => output += d.toString());
    ffprobe.on('close', () => {
      const dur = parseFloat(output.trim());
      resolve(isNaN(dur) ? 30 : dur); // default 30s إذا فشل
    });
    ffprobe.on('error', () => resolve(30));
  });
}

async function processFFmpegJob(jobId, imagesInput, audioUrl, videosInput) {
  const outputFile = getJobOutputPath(jobId);
  const job = activeJobs[jobId];
  
  if (!job) {
    logError('المهمة غير موجودة', { jobId });
    return;
  }

  // تحديد وضع العمل: فيديو أو صورة
  const videoUrls = Array.isArray(videosInput) && videosInput.length > 0 ? videosInput : [];
  const imageUrls = Array.isArray(imagesInput) ? imagesInput : (imagesInput ? [imagesInput] : []);
  const isVideoMode = videoUrls.length > 0;

  logInfo(`بدء معالجة FFmpeg للمهمة ${jobId}`, {
    mode: isVideoMode ? 'video' : 'image',
    videosCount: videoUrls.length,
    imagesCount: imageUrls.length,
    audioUrl,
    outputFile
  });

  let localMediaPaths = []; // صور أو فيديوهات
  let localAudioPath = null;

  try {
    job.status = 'downloading';
    job.progress = 5;

    if (isVideoMode) {
      // ===== وضع الفيديو: تحميل كل الكليبات =====
      job.logs.push(`تحميل ${videoUrls.length} فيديو وملف الصوت...`);
      for (let i = 0; i < videoUrls.length; i++) {
        const localPath = await downloadFile(videoUrls[i], `${jobId}_v${i}`, `video_${i}`);
        if (fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
          localMediaPaths.push(localPath);
          logInfo(`✓ تم تحميل الفيديو ${i + 1}/${videoUrls.length}`);
        } else {
          logError(`❌ فشل تحميل الفيديو ${i + 1} - تخطي`);
        }
        job.progress = 5 + Math.round((i + 1) / videoUrls.length * 8);
      }
      if (localMediaPaths.length === 0) throw new Error('فشل تحميل جميع الفيديوهات');
    } else {
      // ===== وضع الصورة: تحميل كل الصور =====
      job.logs.push(`تحميل ${imageUrls.length} صورة وملف الصوت...`);
      for (let i = 0; i < imageUrls.length; i++) {
        const localPath = await downloadFile(imageUrls[i], `${jobId}_${i}`, `image_${i}`);
        if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
          localMediaPaths.push(localPath);
          logInfo(`✓ تم تحميل الصورة ${i + 1}/${imageUrls.length}`);
        } else {
          logError(`❌ فشل تحميل الصورة ${i + 1} - تخطي`);
        }
        job.progress = 5 + Math.round((i + 1) / imageUrls.length * 8);
      }
      if (localMediaPaths.length === 0) throw new Error('فشل تحميل جميع الصور');
    }

    localAudioPath = await downloadFile(audioUrl, jobId, 'audio');
    job.progress = 15;
    job.logs.push(`✓ تم تحميل ${localMediaPaths.length} ${isVideoMode ? 'فيديو' : 'صورة'} وملف الصوت`);

    if (!fs.existsSync(localAudioPath) || fs.statSync(localAudioPath).size === 0) {
      throw new Error('ملف الصوت فارغ أو غير موجود');
    }

    job.status = 'processing';
    job.progress = 20;
    job.logs.push(`بدء عملية الدمج (${localMediaPaths.length} ${isVideoMode ? 'فيديو' : 'صورة'})...`);

    // بناء FFmpeg args
    let ffmpegArgs;

    if (isVideoMode) {
      // احصل على مدة الصوت أولاً
      const audioDuration = await getAudioDuration(localAudioPath);
      logInfo(`مدة الصوت: ${audioDuration.toFixed(2)}s`);

      if (localMediaPaths.length === 1) {
        // فيديو واحد: loop لمدة الصوت بالضبط
        ffmpegArgs = [
          '-y',
          '-stream_loop', '-1',
          '-i', localMediaPaths[0],
          '-i', localAudioPath,
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '44100',
          '-t', audioDuration.toFixed(3),
          '-movflags', '+faststart',
          outputFile
        ];
        logInfo(`loop فيديو واحد لـ ${audioDuration.toFixed(2)}s`);
      } else {
        // فيديوهات متعددة: concat مع تكرار إذا كانت أقصر من الصوت
        const estClipDuration = 6; // seedance افتراضي
        const estTotal = localMediaPaths.length * estClipDuration;
        let videoList = [...localMediaPaths];
        if (estTotal < audioDuration) {
          const repeatTimes = Math.ceil(audioDuration / estTotal);
          const original = [...videoList];
          for (let r = 1; r < repeatTimes; r++) videoList = videoList.concat(original);
          logInfo(`تكرار ${repeatTimes}x لتغطية ${audioDuration.toFixed(2)}s`);
        }
        const concatFile = path.join(TEMP_DIR, `${jobId}_vconcat.txt`);
        fs.writeFileSync(concatFile, videoList.map(p => `file '${p}'`).join('\n'));
        logInfo(`concat list: ${videoList.length} إدخال`);

        ffmpegArgs = [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatFile,
          '-i', localAudioPath,
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '44100',
          '-t', audioDuration.toFixed(3),
          '-movflags', '+faststart',
          outputFile
        ];
      }
    } else {
      // ===== صور: Ken Burns effect (zoom + pan) =====
      const audioDuration = await getAudioDuration(localAudioPath);
      const durationPerImage = audioDuration / localMediaPaths.length;
      const fps = 25;
      const framesPerImg = Math.round(durationPerImage * fps);
      logInfo(`Ken Burns: ${localMediaPaths.length} صورة - ${durationPerImage.toFixed(2)}s/صورة - ${framesPerImg} frame/صورة`);

      // أنماط Ken Burns: كل صورة لها حركة مختلفة
      const kenBurnsPatterns = [
        // zoom in من المركز
        `scale=8000:-1,zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${framesPerImg}:s=1080x1920:fps=${fps}`,
        // zoom out مع pan يسار
        `scale=8000:-1,zoompan=z='if(lte(zoom,1.0),1.5,max(1.001,zoom-0.0015))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${framesPerImg}:s=1080x1920:fps=${fps}`,
        // pan من يسار لليمين مع zoom خفيف
        `scale=8000:-1,zoompan=z='min(zoom+0.001,1.3)':x='if(lte(on,1),0,x+1.5)':y='ih/2-(ih/zoom/2)':d=${framesPerImg}:s=1080x1920:fps=${fps}`,
        // pan من فوق لتحت
        `scale=8000:-1,zoompan=z='1.3':x='iw/2-(iw/zoom/2)':y='if(lte(on,1),0,y+1.5)':d=${framesPerImg}:s=1080x1920:fps=${fps}`,
        // zoom in مع pan قطري
        `scale=8000:-1,zoompan=z='min(zoom+0.002,1.6)':x='if(lte(on,1),0,x+1)':y='if(lte(on,1),0,y+1)':d=${framesPerImg}:s=1080x1920:fps=${fps}`,
      ];

      // بناء complex filter لكل الصور
      const inputArgs = [];
      for (const imgPath of localMediaPaths) {
        inputArgs.push('-loop', '1', '-t', durationPerImage.toFixed(3), '-i', imgPath);
      }

      // بناء filtergraph
      let filterParts = [];
      for (let i = 0; i < localMediaPaths.length; i++) {
        const pattern = kenBurnsPatterns[i % kenBurnsPatterns.length];
        filterParts.push(`[${i}:v]${pattern},setsar=1,format=yuv420p[v${i}]`);
      }
      const concatInputs = localMediaPaths.map((_, i) => `[v${i}]`).join('');
      filterParts.push(`${concatInputs}concat=n=${localMediaPaths.length}:v=1:a=0[vout]`);
      const filterComplex = filterParts.join('; ');

      ffmpegArgs = [
        '-y',
        ...inputArgs,
        '-i', localAudioPath,
        '-filter_complex', filterComplex,
        '-map', '[vout]',
        '-map', `${localMediaPaths.length}:a:0`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-t', audioDuration.toFixed(3),
        '-movflags', '+faststart',
        outputFile
      ];
    }

    logInfo('أوامر FFmpeg', { args: ffmpegArgs.join(' ') });

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    job.process = ffmpeg;
    job.startTime = Date.now();

    // Handle stderr (FFmpeg outputs progress here)
    ffmpeg.stderr.on('data', (data) => {
      const message = data.toString();
      
      // Log only important messages (not every frame)
      if (message.includes('error') || message.includes('warning') || message.includes('Duration')) {
        job.logs.push(`[FFmpeg] ${message.substring(0, 200)}`);
      }
      
      // Parse progress
      if (message.includes('time=')) {
        const timeMatch = message.match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch) {
          const seconds = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
          job.progress = Math.min(85, 20 + Math.floor(seconds * 2)); // Progress from 20 to 85
        }
      }
      
      // Check for specific errors
      if (message.toLowerCase().includes('invalid data found')) {
        logError(`FFmpeg: بيانات غير صالحة [${jobId}]`, message.substring(0, 300));
      }
      if (message.toLowerCase().includes('error opening filters')) {
        logError(`FFmpeg: خطأ في الفلاتر [${jobId}]`, message.substring(0, 300));
      }
    });

    // Handle completion
    ffmpeg.on('close', async (code) => {
      const duration = Date.now() - job.startTime;
      logInfo(`FFmpeg انتهى [${jobId}]`, { code, durationMs: duration });

      // Clean up temp files
      cleanupTempFiles(jobId);
      for (const cf of [path.join(TEMP_DIR, `${jobId}_concat.txt`), path.join(TEMP_DIR, `${jobId}_vconcat.txt`)]) {
        if (fs.existsSync(cf)) { try { fs.unlinkSync(cf); } catch {} }
      }

      if (code === 0) {
        // Success
        try {
          // Check if file exists and has content
          if (!fs.existsSync(outputFile)) {
            throw new Error('ملف الإخراج غير موجود');
          }
          
          const stats = fs.statSync(outputFile);
          if (stats.size === 0) {
            throw new Error('ملف الإخراج فارغ');
          }
          
          logInfo(`✓ تم إنشاء ملف الفيديو بنجاح [${jobId}]`, { 
            size: stats.size,
            path: outputFile 
          });
          
          job.progress = 90;
          job.status = 'uploading';
          job.logs.push('رفع الفيديو...');

          // Try to upload to Supabase
          const publicUrl = await uploadToSupabase(jobId, outputFile);
          
          if (publicUrl) {
            job.videoUrl = publicUrl;
            job.output_url = publicUrl; // ✅ إضافة output_url أيضاً
            job.outputType = 'supabase';
            job.logs.push('✓ تم الرفع إلى Supabase');
            
            // Clean up local file after successful upload
            try {
              fs.unlinkSync(outputFile);
              logInfo(`تم حذف الملف المحلي بعد التحميل [${jobId}]`);
            } catch (unlinkError) {
              logWarning(`فشل حذف الملف المحلي [${jobId}]`, unlinkError);
            }
          } else {
            // Use local file URL if Supabase upload failed
            const localUrl = `/output/${jobId}.mp4`;
            job.videoUrl = localUrl;
            job.output_url = localUrl; // ✅ إضافة output_url أيضاً
            job.outputType = 'local';
            job.logs.push('✓ الفيديو متاح محلياً');
            logInfo(`استخدام الملف المحلي [${jobId}]`, { url: localUrl });
          }
          
          job.status = 'completed';
          job.progress = 100;
          job.logs.push('✓ اكتملت المهمة بنجاح!');
          
          logInfo(`✓✓✓ المهمة ${jobId} اكتملت بنجاح ✓✓✓`, { 
            videoUrl: job.videoUrl,
            output_url: job.output_url,
            outputType: job.outputType,
            duration: duration
          });
          
        } catch (error) {
          logError(`فشلت معالجة ما بعد FFmpeg [${jobId}]`, error);
          job.status = 'failed';
          job.error = error.message;
          job.logs.push(`✗ خطأ: ${error.message}`);
        }
      } else {
        // FFmpeg failed
        const errorMessage = `عملية FFmpeg فشلت برمز الخروج ${code}`;
        const errorDetails = job.logs.slice(-10).join('\n');
        
        logError(errorMessage, { 
          jobId, 
          code,
          recentLogs: errorDetails
        });
        
        job.status = 'failed';
        job.error = `${errorMessage}\n\nآخر سجلات FFmpeg:\n${errorDetails}`;
        job.logs.push(`✗ ${errorMessage}`);
      }
    });

    // Handle errors
    ffmpeg.on('error', (error) => {
      logError(`خطأ في عملية FFmpeg [${jobId}]`, error);
      cleanupTempFiles(jobId);
      job.status = 'failed';
      job.error = `خطأ في بدء FFmpeg: ${error.message}`;
      job.logs.push(`✗ خطأ في العملية: ${error.message}`);
    });
    
  } catch (downloadError) {
    // Download or preparation error
    logError(`فشل التحضير للمهمة [${jobId}]`, downloadError);
    cleanupTempFiles(jobId);
    job.status = 'failed';
    job.error = `فشل تحميل الملفات: ${downloadError.message}`;
    job.logs.push(`✗ ${downloadError.message}`);
  }
}

// ===== ENDPOINTS =====

// Health check
app.get('/', (req, res) => {
  logInfo('طلب فحص صحي', { 
    method: req.method,
    path: req.path,
    ip: req.ip 
  });
  
  res.json({
    status: 'healthy',
    message: 'سيرفر دمج الفيديو يعمل بشكل صحيح',
    version: '2.1.0',
    uptime: process.uptime(),
    endpoints: {
      merge: 'POST /merge',
      startMerge: 'POST /start-merge',
      status: 'GET /status/:jobId',
      jobStatus: 'GET /job-status/:jobId',
      cancel: 'POST /cancel-job',
      output: 'GET /output/:jobId.mp4'
    },
    features: [
      'تحميل محلي للملفات (يحل مشاكل APIs)',
      'دعم جميع تنسيقات الصوت',
      'إرجاع output_url في جميع الاستجابات',
      'تسجيل مفصل للأخطاء'
    ],
    activeJobs: Object.keys(activeJobs).length,
    supabaseConnected: !!supabase
  });
});

// Start merge job (both endpoints)
const handleStartJob = async (req, res) => {
  const requestId = `req_${Date.now()}`;
  
  logInfo(`طلب دمج جديد [${requestId}]`, {
    method: req.method,
    path: req.path,
    body: req.body
  });

  const { imageUrl, audioUrl, images, videos, audio } = req.body;
  
  // جمع كل الفيديوهات المرسلة
  const allVideos = [];
  if (Array.isArray(videos) && videos.length > 0) {
    videos.forEach(u => { if (u) allVideos.push(sanitizeUrl(u)); });
  }
  
  // جمع كل الصور المرسلة (images[] + imageUrl) - fallback إذا لا يوجد فيديو
  const allImages = [];
  if (allVideos.length === 0) {
    if (Array.isArray(images) && images.length > 0) {
      images.forEach(u => { if (u) allImages.push(sanitizeUrl(u)); });
    } else if (imageUrl) {
      allImages.push(sanitizeUrl(imageUrl));
    }
  }
  
  const normalizedAudioUrl = sanitizeUrl(audioUrl || audio);
  const isVideoMode = allVideos.length > 0;
  
  // تحقق من وجود محتوى مرئي وصوت
  if (allVideos.length === 0 && allImages.length === 0) {
    logError('لا توجد صور أو فيديوهات في الطلب', { received: req.body });
    return res.status(400).json({ error: 'مطلوب صورة أو فيديو واحد على الأقل', received: req.body });
  }
  if (!normalizedAudioUrl) {
    logError('لا يوجد ملف صوت في الطلب');
    return res.status(400).json({ error: 'ملف الصوت مطلوب' });
  }
  
  const mediaCount = isVideoMode ? allVideos.length : allImages.length;
  const mediaType = isVideoMode ? 'فيديو' : 'صورة';
  
  // Create job
  const jobId = generateJobId();
  activeJobs[jobId] = {
    id: jobId,
    job_id: jobId,
    status: 'processing',
    progress: 0,
    logs: [`تم إنشاء المهمة - ${mediaCount} ${mediaType}`],
    imageUrl: allImages[0] || allVideos[0],
    images: allImages,
    videos: allVideos,
    audioUrl: normalizedAudioUrl,
    isVideoMode,
    createdAt: new Date().toISOString(),
    requestId
  };
  
  logInfo(`✓ تم إنشاء المهمة ${jobId}`, {
    mode: mediaType,
    mediaCount,
    audioUrl: normalizedAudioUrl
  });
  
  // Respond immediately
  res.json({ 
    jobId,
    job_id: jobId,
    status: 'processing',
    message: `تم بدء عملية الدمج (${mediaCount} ${mediaType}).`
  });
  
  // Start processing asynchronously
  processFFmpegJob(jobId, allImages, normalizedAudioUrl, allVideos)
    .catch(error => {
      logError(`فشل معالجة المهمة ${jobId}`, error);
      if (activeJobs[jobId]) {
        activeJobs[jobId].status = 'failed';
        activeJobs[jobId].error = error.message;
      }
    });
};

app.post('/merge', handleStartJob);
app.post('/start-merge', handleStartJob);

// Get job status (both endpoints)
const handleJobStatus = (req, res) => {
  const jobId = req.params.jobId;
  const job = activeJobs[jobId];
  
  logInfo(`طلب حالة المهمة [${jobId}]`);
  
  if (!job) {
    logWarning(`المهمة غير موجودة [${jobId}]`);
    return res.status(404).json({ 
      error: 'المهمة غير موجودة',
      jobId,
      suggestion: 'تأكد من معرف المهمة أو قد تكون المهمة قد انتهت وتم حذفها'
    });
  }
  
  const response = {
    jobId: job.id,
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    logs: job.logs.slice(-5),
    videoUrl: job.videoUrl,
    video_url: job.videoUrl,
    output_url: job.output_url || job.videoUrl, // ✅ ضمان وجود output_url
    error: job.error,
    createdAt: job.createdAt,
    outputType: job.outputType
  };
  
  logInfo(`حالة المهمة [${jobId}]`, { 
    status: job.status, 
    progress: job.progress,
    hasVideo: !!job.videoUrl,
    hasOutputUrl: !!(job.output_url || job.videoUrl)
  });
  
  res.json(response);
};

app.get('/status/:jobId', handleJobStatus);
app.get('/job-status/:jobId', handleJobStatus);
app.get('/merge/status/:jobId', handleJobStatus);

// POST status check (for compatibility)
app.post('/status', (req, res) => {
  const jobId = req.body.jobId || req.body.job_id;
  
  if (!jobId) {
    return res.status(400).json({ error: 'jobId مطلوب في الجسم' });
  }
  
  req.params.jobId = jobId;
  handleJobStatus(req, res);
});

// Cancel job
app.post('/cancel-job', (req, res) => {
  const jobId = req.body.jobId || req.body.job_id;
  const job = activeJobs[jobId];
  
  logInfo(`طلب إلغاء المهمة [${jobId}]`);
  
  if (!job) {
    return res.status(404).json({ error: 'المهمة غير موجودة' });
  }
  
  if (job.process) {
    job.process.kill('SIGKILL');
    logInfo(`✓ تم إنهاء عملية FFmpeg [${jobId}]`);
  }
  
  // Clean up temp files
  cleanupTempFiles(jobId);
  
  job.status = 'cancelled';
  job.logs.push('تم إلغاء المهمة من قبل المستخدم');
  
  res.json({ 
    message: 'تم إلغاء المهمة',
    jobId,
    status: 'cancelled'
  });
});

// ===== GENERATE CLIPS (parallel video generation) =====
/**
 * POST /generate-clips
 * يستقبل: { prompts: string[], job_id: string, supabase_url: string, supabase_key: string, parallelism?: number }
 * يولّد كل الكليبات بالتوازي (grok → seedance → wan → flux)
 * يرفعهم مباشرة على Supabase Storage
 * يرجع: { clips: [{url, type, index, model}], failed: number[] }
 */

// seedance أولاً (أفضل جودة فيديو) ثم wan كبديل
// grok في Pollinations نموذج صور وليس فيديو — محذوف من هنا
const POLLINATIONS_MODELS = [
  { name: 'seedance', retries: 3, timeoutMs: 90000, extraParams: '&duration=6' },
  { name: 'wan',      retries: 3, timeoutMs: 90000 },
];

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function generateSingleClip(prompt, index, pollinationsApiKey) {
  const seed = Math.floor(Math.random() * 2147483647);
  const headers = {
    'Authorization': `Bearer ${pollinationsApiKey}`,
    'Accept': 'video/mp4,video/*,image/*',
    'User-Agent': 'Mozilla/5.0',
  };

  // جرّب كل نموذج فيديو بالترتيب
  for (const model of POLLINATIONS_MODELS) {
    let lastErr = '';
    for (let attempt = 1; attempt <= model.retries; attempt++) {
      logInfo(`[CLIP ${index}] ${model.name} محاولة ${attempt}/${model.retries}`);
      try {
        const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=${model.name}&width=1080&height=1920&seed=${seed}&safe=false&nologo=true${model.extraParams || ''}`;
        const res = await fetchWithTimeout(url, { headers }, model.timeoutMs);
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          if (res.status === 401 || res.status === 403) break; // مفتاح غلط — تخطّ النموذج
          if (res.status === 402 || res.status === 429) {
            logWarning(`[CLIP ${index}] ${model.name} يتطلب دفع أو تجاوز الحد (HTTP ${res.status}) — جاري التخطي فوراً`);
            break; // تخط النموذج فوراً إذا طلب دفع
          }
          if (attempt < model.retries) await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        const contentType = res.headers.get('content-type') || '';
        const buf = Buffer.from(await res.arrayBuffer());
        if (!contentType.includes('video') && !contentType.includes('mp4') && !contentType.includes('octet-stream')) {
          // Pollinations may return images instead of video — check buffer magic bytes
          if (buf.length > 10000) {
            // Large enough buffer, could be a valid video regardless of content-type
            logInfo(`[CLIP ${index}] ${model.name} — نوع: ${contentType}, حجم: ${buf.length}B — قبول كفيديو`);
            return { buffer: buf, type: 'video', model: model.name };
          }
          lastErr = `نوع غير متوقع: ${contentType} (${buf.length}B)`;
          if (attempt < model.retries) await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        if (buf.length < 5000) {
          lastErr = `ملف صغير جداً: ${buf.length}B`;
          if (attempt < model.retries) await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        logInfo(`[CLIP ${index}] ✅ ${model.name} — ${(buf.length / 1024).toFixed(1)}KB`);
        return { buffer: buf, type: 'video', model: model.name };
      } catch (e) {
        lastErr = e.name === 'AbortError' ? `timeout ${model.timeoutMs / 1000}s` : e.message;
        logError(`[CLIP ${index}] ${model.name} خطأ: ${lastErr}`);
        if (attempt < model.retries) await new Promise(r => setTimeout(r, 5000));
      }
    }
    logWarning(`[CLIP ${index}] ${model.name} فشل نهائياً: ${lastErr}`);
  }

  // احتياطي: صورة (باستخدام مفتاح Pollinations نفسه للحساب المدفوع)
  logWarning(`[CLIP ${index}] كل الفيديو فشل — جاري توليد صورة عبر Pollinations`);
  for (const imgModel of ['flux', 'flux-realism']) {
    try {
      const imgSeed = Math.floor(Math.random() * 2147483647);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${imgModel}&width=1080&height=1920&seed=${imgSeed}&nologo=true`;
      
      // نستخدم مفتاح Pollinations للحساب المدفوع
      const imgHeaders = {
        'Authorization': `Bearer ${pollinationsApiKey}`,
        'Accept': 'image/jpeg,image/*,*/*',
        'User-Agent': 'Mozilla/5.0'
      };
      
      const res = await fetchWithTimeout(url, { headers: imgHeaders }, 60000);
      if (!res.ok) {
        logWarning(`[CLIP ${index}] 🖼️ صورة (${imgModel}) فشلت: HTTP ${res.status}`);
        if (res.status === 402 || res.status === 429 || res.status === 401) break;
        continue;
      }
      const contentType = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 5000) continue;
      if (!contentType.includes('image') && !contentType.includes('octet') && !contentType.includes('jpeg') && !contentType.includes('png')) continue;
      logInfo(`[CLIP ${index}] 🖼️ ✅ صورة (${imgModel}) — ${(buf.length / 1024).toFixed(1)}KB`);
      return { buffer: buf, type: 'image', model: imgModel };
    } catch (e) {
      logError(`[CLIP ${index}] فشل الصورة (${imgModel}): ${e.message}`);
    }
  }

  return null; // فشل تام
}

async function uploadClipToSupabase(supabaseClient, jobId, index, buffer, type) {
  const ext = type === 'video' ? 'mp4' : 'jpg';
  const contentType = type === 'video' ? 'video/mp4' : 'image/jpeg';
  const filePath = `${jobId}/clip_${index}.${ext}`;
  const { error } = await supabaseClient.storage
    .from('temp-files')
    .upload(filePath, buffer, { contentType, upsert: true });
  if (error) throw new Error(`رفع فشل: ${error.message}`);
  const { data } = supabaseClient.storage.from('temp-files').getPublicUrl(filePath);
  return data.publicUrl;
}

app.post('/generate-clips', async (req, res) => {
  const {
    prompts,
    job_id,
    supabase_url,
    supabase_key,
    pollinations_api_key,
    parallelism = 3,
  } = req.body;

  if (!prompts || !Array.isArray(prompts) || prompts.length === 0)
    return res.status(400).json({ error: 'prompts مطلوب (array)' });
  if (!job_id)
    return res.status(400).json({ error: 'job_id مطلوب' });

  // إنشاء Supabase client مؤقت لهذا الطلب
  const sb = (supabase_url && supabase_key)
    ? createClient(supabase_url, supabase_key)
    : supabase;

  if (!sb)
    return res.status(500).json({ error: 'Supabase غير متاح' });

  const apiKey = pollinations_api_key || process.env.POLLINATIONS_API_KEY || 'sk_E7DZagW8HKHCBUrMJjXm8bAhI2O1Pye9';
  const concurrency = Math.min(Math.max(1, parallelism), 5); // 1-5

  logInfo(`[GEN-CLIPS] بدء: ${prompts.length} كليب، توازي: ${concurrency}، job: ${job_id}`);

  // توليد ورفع كل الكليبات بالتوازي (على دفعات بحجم concurrency)
  const results = new Array(prompts.length).fill(null);

  for (let batchStart = 0; batchStart < prompts.length; batchStart += concurrency) {
    const batchEnd = Math.min(batchStart + concurrency, prompts.length);
    const batchIndices = [];
    for (let i = batchStart; i < batchEnd; i++) batchIndices.push(i);

    logInfo(`[GEN-CLIPS] دفعة ${Math.floor(batchStart / concurrency) + 1}: كليبات ${batchIndices.join(', ')}`);

    // تشغيل الدفعة بالتوازي
    await Promise.all(batchIndices.map(async (i) => {
      try {
        const clip = await generateSingleClip(prompts[i], i, apiKey);
        if (clip) {
          const url = await uploadClipToSupabase(sb, job_id, i, clip.buffer, clip.type);
          results[i] = { url, type: clip.type, model: clip.model, index: i };
          logInfo(`[GEN-CLIPS] ✅ كليب ${i} محفوظ: ${clip.type} (${clip.model})`);
        } else {
          logError(`[GEN-CLIPS] ❌ كليب ${i} فشل تماماً`);
        }
      } catch (e) {
        logError(`[GEN-CLIPS] ❌ كليب ${i} استثناء: ${e.message}`);
      }
    }));
  }

  const successClips = results.filter(r => r !== null);
  const failedIndices = results.map((r, i) => r === null ? i : -1).filter(i => i >= 0);

  logInfo(`[GEN-CLIPS] ✅ انتهى: ${successClips.length}/${prompts.length} نجح`);

  res.json({
    clips: results,            // كل النتائج بالترتيب (null = فشل)
    success: successClips,     // الناجحة فقط
    failed_indices: failedIndices,
    total: prompts.length,
    succeeded: successClips.length,
    failed: failedIndices.length,
  });
});

// ===== TTS PROXY (ElevenLabs via HuggingFace IP) =====
app.post('/tts', async (req, res) => {
  const { text, voice_id, api_key, model_id, voice_settings } = req.body;
  if (!text || !voice_id || !api_key)
    return res.status(400).json({ error: 'text و voice_id و api_key مطلوبون' });

  logInfo(`[TTS-PROXY] ${text.length} حرف`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': api_key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: model_id || 'eleven_multilingual_v2',
          voice_settings: voice_settings || { stability: 0.65, similarity_boost: 0.82, style: 0.40, use_speaker_boost: true },
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      logError(`[TTS-PROXY] ElevenLabs ${response.status}`, errBody);
      return res.status(response.status).json({ error: `ElevenLabs: HTTP ${response.status}`, details: errBody.slice(0, 300) });
    }
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    if (audioBuffer.length < 1000)
      return res.status(500).json({ error: 'ملف صوت فارغ' });
    logInfo(`[TTS-PROXY] ✅ ${(audioBuffer.length / 1024).toFixed(1)}KB`);
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length, 'Cache-Control': 'no-cache' });
    res.send(audioBuffer);
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'timeout (2 دقيقة)' : err.message;
    logError('[TTS-PROXY] خطأ', msg);
    res.status(500).json({ error: `فشل: ${msg}` });
  }
});

// Serve output files
app.use('/output', express.static(OUTPUT_DIR));

// 404 handler
app.use((req, res) => {
  logWarning('نقطة نهاية غير موجودة', { 
    method: req.method,
    path: req.path 
  });
  
  res.status(404).json({
    error: 'نقطة النهاية غير موجودة',
    path: req.path,
    availableEndpoints: {
      health: 'GET /',
      merge: 'POST /merge',
      startMerge: 'POST /start-merge',
      status: 'GET /status/:jobId',
      jobStatus: 'GET /job-status/:jobId',
      cancel: 'POST /cancel-job'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  logError('خطأ غير متوقع في السيرفر', err);
  
  res.status(500).json({
    error: 'خطأ داخلي في السيرفر',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// ===== CLEANUP =====

// Clean up old jobs every 10 minutes
setInterval(() => {
  const now = Date.now();
  const TEN_MINUTES = 10 * 60 * 1000;
  let cleaned = 0;
  
  for (const jobId in activeJobs) {
    const job = activeJobs[jobId];
    const createdAt = new Date(job.createdAt).getTime();
    
    if ((job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') 
        && (now - createdAt > TEN_MINUTES)) {
      delete activeJobs[jobId];
      cleaned++;
      
      // Clean up files
      const outputFile = getJobOutputPath(jobId);
      if (fs.existsSync(outputFile)) {
        try {
          fs.unlinkSync(outputFile);
        } catch (err) {
          logWarning(`فشل حذف الملف القديم [${jobId}]`, err);
        }
      }
      cleanupTempFiles(jobId);
    }
  }
  
  if (cleaned > 0) {
    logInfo(`تنظيف دوري: تم حذف ${cleaned} مهمة قديمة`);
  }
}, 10 * 60 * 1000);

// ===== START SERVER =====

const PORT = process.env.PORT || 7860;

app.listen(PORT, '0.0.0.0', () => {
  logInfo(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     🎬 سيرفر دمج الفيديو - FFmpeg Space v2.1              ║
║                                                            ║
║     🚀 السيرفر يعمل على المنفذ ${PORT}                    ║
║     🔗 الرابط: http://localhost:${PORT}                   ║
║     ✅ FFmpeg: متوفر                                       ║
║     ${supabase ? '✅' : '⚠️ '} Supabase: ${supabase ? 'متصل' : 'غير متصل'}                          ║
║                                                            ║
║     🆕 التحسينات الجديدة:                                 ║
║       - تحميل محلي للملفات (يحل مشاكل APIs)              ║
║       - دعم كامل لملفات ElevenLabs                        ║
║       - إرجاع output_url في جميع الحالات                 ║
║       - معالجة محسّنة للأخطاء                             ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logInfo('تلقي إشارة SIGTERM، إغلاق السيرفر بشكل سليم...');
  
  for (const jobId in activeJobs) {
    if (activeJobs[jobId].process) {
      activeJobs[jobId].process.kill('SIGKILL');
    }
    cleanupTempFiles(jobId);
  }
  
  process.exit(0);
});

process.on('SIGINT', () => {
  logInfo('تلقي إشارة SIGINT، إغلاق السيرفر...');
  process.exit(0);
});