/**
 * Audio Helper - حفظ الصوت من ElevenLabs في Supabase
 * نسخة محسّنة مع معالجة أخطاء شاملة
 */

import { supabase } from "./supabase.ts";
import { generateSpeech } from "./elevenlabs.ts";

// ===== LOGGING =====
function logInfo(message: string, data?: any) {
  console.log(`[AUDIO-HELPER] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function logError(message: string, error?: any) {
  console.error(`[AUDIO-HELPER] ${message}`, error ? (error instanceof Error ? error.message : JSON.stringify(error)) : '');
}

function logWarning(message: string, data?: any) {
  console.warn(`[AUDIO-HELPER] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// ===== AUDIO STORAGE =====

/**
 * حفظ ArrayBuffer الصوت في Supabase Storage والحصول على رابط عام
 * 
 * @param audioBuffer - البيانات الصوتية من ElevenLabs
 * @param jobId - معرف فريد للمهمة
 * @param bucketName - اسم Bucket في Supabase (افتراضي: 'media-output')
 * @returns رابط عام للملف الصوتي
 */
export async function saveAudioToStorage(
  audioBuffer: ArrayBuffer,
  jobId: string,
  bucketName: string = 'media-output'
): Promise<string> {
  
  if (!audioBuffer || audioBuffer.byteLength === 0) {
    throw new Error('بيانات الصوت فارغة');
  }
  
  logInfo('حفظ الصوت في Supabase', {
    jobId,
    size: audioBuffer.byteLength,
    bucket: bucketName
  });
  
  const audioFileName = `${jobId}/audio.mp3`;
  
  try {
    // التحقق من وجود Bucket أولاً
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    
    if (bucketsError) {
      logError('فشل التحقق من Buckets', bucketsError);
      throw new Error(`فشل التحقق من وجود Bucket: ${bucketsError.message}`);
    }
    
    const bucketExists = buckets?.some(b => b.name === bucketName);
    
    if (!bucketExists) {
      logWarning(`Bucket '${bucketName}' غير موجود، محاولة إنشائه...`);
      
      const { error: createError } = await supabase.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: 52428800, // 50MB
        allowedMimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav']
      });
      
      if (createError && !createError.message.includes('already exists')) {
        throw new Error(`فشل إنشاء Bucket: ${createError.message}`);
      }
      
      logInfo(`✓ تم إنشاء Bucket '${bucketName}'`);
    }
    
    // رفع الملف مع محاولات متعددة
    let uploadError: any = null;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logInfo(`محاولة رفع ${attempt}/${maxRetries}...`);
      
      const { error } = await supabase.storage
        .from(bucketName)
        .upload(audioFileName, audioBuffer, {
          contentType: 'audio/mpeg',
          upsert: true,
        });
      
      if (!error) {
        uploadError = null;
        break;
      }
      
      uploadError = error;
      logWarning(`فشلت محاولة ${attempt}:`, error.message);
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    
    if (uploadError) {
      logError('فشل رفع الصوت إلى Supabase بعد محاولات متعددة', uploadError);
      throw new Error(`فشل رفع الصوت: ${uploadError.message}`);
    }
    
    // الحصول على الرابط العام
    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(audioFileName);
    
    if (!publicUrlData || !publicUrlData.publicUrl) {
      throw new Error('فشل الحصول على الرابط العام للصوت');
    }
    
    // التحقق من أن الرابط يعمل
    try {
      const testResponse = await fetch(publicUrlData.publicUrl, { method: 'HEAD' });
      
      if (!testResponse.ok) {
        logWarning(`الرابط العام لا يعمل: HTTP ${testResponse.status}`);
      } else {
        logInfo('✓ تم التحقق من الرابط العام بنجاح');
      }
    } catch (testError) {
      logWarning('فشل التحقق من الرابط العام', testError);
    }
    
    logInfo('✓ تم حفظ الصوت بنجاح', {
      url: publicUrlData.publicUrl,
      fileName: audioFileName
    });
    
    return publicUrlData.publicUrl;
    
  } catch (error) {
    logError('خطأ في حفظ الصوت', error);
    throw error;
  }
}

// ===== COMPLETE WORKFLOW =====

/**
 * سير عمل كامل: إنشاء صوت من ElevenLabs وحفظه في Supabase
 * 
 * @param text - النص المراد تحويله لصوت
 * @param jobId - معرف فريد للمهمة
 * @param voiceId - معرف الصوت في ElevenLabs (اختياري)
 * @param bucketName - اسم Bucket (اختياري)
 * @returns رابط عام للملف الصوتي
 */
export async function createAndSaveAudio(
  text: string,
  jobId: string,
  voiceId?: string,
  bucketName: string = 'media-output'
): Promise<string> {
  
  logInfo('بدء إنشاء وحفظ الصوت', { jobId, textLength: text.length });
  
  // التحقق من صحة المدخلات
  if (!text || text.trim().length === 0) {
    throw new Error('النص المراد تحويله لصوت فارغ');
  }
  
  if (text.length > 5000) {
    logWarning('النص طويل جداً، قد يستغرق وقتاً أطول', { length: text.length });
  }
  
  try {
    // 1. إنشاء الصوت من ElevenLabs
    logInfo('الخطوة 1: إنشاء الصوت من ElevenLabs...');
    const audioBuffer = await generateSpeech(text, voiceId);
    
    if (!audioBuffer) {
      throw new Error('فشل إنشاء الصوت من ElevenLabs - لم يُرجع بيانات');
    }
    
    logInfo(`✓ تم إنشاء الصوت (${audioBuffer.byteLength} bytes)`);
    
    // التحقق من حجم معقول
    if (audioBuffer.byteLength < 1000) {
      logWarning('حجم الصوت صغير جداً، قد يكون خطأ', { size: audioBuffer.byteLength });
    }
    
    if (audioBuffer.byteLength > 50 * 1024 * 1024) { // 50MB
      throw new Error(`حجم الصوت كبير جداً: ${audioBuffer.byteLength} bytes (الحد الأقصى: 50MB)`);
    }
    
    // 2. حفظ الصوت في Supabase
    logInfo('الخطوة 2: حفظ الصوت في Supabase...');
    const audioUrl = await saveAudioToStorage(audioBuffer, jobId, bucketName);
    
    logInfo('✓✓✓ اكتمل إنشاء وحفظ الصوت بنجاح ✓✓✓', { audioUrl });
    
    return audioUrl;
    
  } catch (error) {
    logError('فشل إنشاء وحفظ الصوت', error);
    
    // إضافة سياق إضافي للخطأ
    if (error instanceof Error) {
      throw new Error(
        `فشل إنشاء الصوت:\n` +
        `${error.message}\n\n` +
        `التفاصيل:\n` +
        `- معرف المهمة: ${jobId}\n` +
        `- طول النص: ${text.length} حرف\n` +
        `- معرف الصوت: ${voiceId || 'افتراضي'}`
      );
    }
    
    throw error;
  }
}

// ===== MERGE WITH MEDIA =====

/**
 * سير عمل كامل: إنشاء صوت ودمجه مع صورة
 * 
 * @param text - النص المراد تحويله لصوت
 * @param imageUrl - رابط الصورة
 * @param mergeServerUrl - رابط سيرفر الدمج (افتراضي: Hugging Face Space)
 * @param voiceId - معرف الصوت (اختياري)
 * @returns نتيجة عملية الدمج
 */
export async function createAudioAndMerge(
  text: string,
  imageUrl: string,
  mergeServerUrl: string = 'https://elmalik-ff.hf.space/merge',
  voiceId?: string
): Promise<{
  jobId: string;
  audioUrl: string;
  mergeJobId?: string;
  status: string;
}> {
  
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  logInfo('=== بدء عملية إنشاء الصوت والدمج ===', {
    jobId,
    imageUrl: imageUrl.substring(0, 50),
    textLength: text.length,
    mergeServerUrl
  });
  
  // التحقق من صحة المدخلات
  if (!imageUrl || !imageUrl.startsWith('http')) {
    throw new Error('رابط الصورة غير صالح');
  }
  
  try {
    // 1. إنشاء وحفظ الصوت
    logInfo('الخطوة 1: إنشاء الصوت...');
    const audioUrl = await createAndSaveAudio(text, jobId, voiceId);
    
    // التحقق من أن رابط الصوت يعمل قبل الدمج
    logInfo('الخطوة 2: التحقق من رابط الصوت...');
    const audioValid = await validateAudioUrl(audioUrl);
    
    if (!audioValid) {
      throw new Error('رابط الصوت غير صالح أو لا يمكن الوصول إليه');
    }
    
    // 2. بدء عملية الدمج
    logInfo('الخطوة 3: بدء عملية الدمج...', { 
      imageUrl: imageUrl.substring(0, 100), 
      audioUrl: audioUrl.substring(0, 100) 
    });
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    
    let mergeResponse: Response;
    
    try {
      mergeResponse = await fetch(mergeServerUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'Supabase-Edge-Function/1.0'
        },
        body: JSON.stringify({
          imageUrl: imageUrl,
          audioUrl: audioUrl,
          images: [imageUrl], // دعم كلا التنسيقين
          audio: audioUrl,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      
      if (errorMsg.includes('aborted') || errorMsg.includes('timeout')) {
        throw new Error('انتهت مهلة الاتصال بسيرفر الدمج (60 ثانية). السيرفر قد يكون بطيئاً.');
      }
      
      throw new Error(`فشل الاتصال بسيرفر الدمج: ${errorMsg}`);
    }
    
    const responseText = await mergeResponse.text();
    
    logInfo('استجابة سيرفر الدمج', {
      status: mergeResponse.status,
      response: responseText.substring(0, 300)
    });
    
    if (!mergeResponse.ok) {
      throw new Error(
        `فشل بدء عملية الدمج (HTTP ${mergeResponse.status}):\n${responseText.substring(0, 500)}`
      );
    }
    
    let mergeResult: any;
    
    try {
      mergeResult = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(`استجابة غير صالحة من سيرفر الدمج: ${responseText.substring(0, 200)}`);
    }
    
    logInfo('✓ تم بدء عملية الدمج بنجاح', mergeResult);
    
    return {
      jobId,
      audioUrl,
      mergeJobId: mergeResult.jobId || mergeResult.job_id,
      status: mergeResult.status || 'processing'
    };
    
  } catch (error) {
    logError('فشلت عملية إنشاء الصوت والدمج', error);
    
    // إضافة سياق للخطأ
    if (error instanceof Error) {
      throw new Error(
        `فشلت عملية الإنشاء والدمج:\n` +
        `${error.message}\n\n` +
        `التفاصيل:\n` +
        `- معرف المهمة: ${jobId}\n` +
        `- رابط الصورة: ${imageUrl.substring(0, 100)}\n` +
        `- سيرفر الدمج: ${mergeServerUrl}`
      );
    }
    
    throw error;
  }
}

// ===== CLEANUP =====

/**
 * حذف الملف الصوتي من Supabase Storage
 * 
 * @param jobId - معرف المهمة
 * @param bucketName - اسم Bucket
 */
export async function deleteAudioFromStorage(
  jobId: string,
  bucketName: string = 'media-output'
): Promise<void> {
  
  const audioFileName = `${jobId}/audio.mp3`;
  
  logInfo('حذف الصوت من Supabase', { jobId, fileName: audioFileName });
  
  try {
    const { error } = await supabase.storage
      .from(bucketName)
      .remove([audioFileName]);
    
    if (error) {
      logError('فشل حذف الصوت', error);
      throw new Error(`فشل حذف الصوت: ${error.message}`);
    }
    
    logInfo('✓ تم حذف الصوت بنجاح');
    
  } catch (error) {
    logError('خطأ في حذف الصوت', error);
    throw error;
  }
}

// ===== VALIDATION =====

/**
 * التحقق من أن الملف الصوتي موجود ويمكن الوصول إليه
 * 
 * @param audioUrl - رابط الملف الصوتي
 * @returns true إذا كان الملف موجوداً وصالحاً
 */
export async function validateAudioUrl(audioUrl: string): Promise<boolean> {
  
  logInfo('التحقق من رابط الصوت', { url: audioUrl.substring(0, 100) });
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(audioUrl, { 
      method: 'HEAD',
      signal: controller.signal 
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      logError(`رابط الصوت غير صالح: HTTP ${response.status}`);
      return false;
    }
    
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    
    logInfo('✓ رابط الصوت صالح', {
      status: response.status,
      contentType,
      size: contentLength
    });
    
    // التحقق من نوع المحتوى
    if (contentType && !contentType.includes('audio') && !contentType.includes('mpeg')) {
      logError(`نوع المحتوى غير صالح: ${contentType}`);
      return false;
    }
    
    // التحقق من الحجم
    if (contentLength) {
      const size = parseInt(contentLength);
      
      if (size < 1000) {
        logError(`حجم الملف صغير جداً: ${size} bytes`);
        return false;
      }
      
      if (size > 50 * 1024 * 1024) {
        logError(`حجم الملف كبير جداً: ${size} bytes`);
        return false;
      }
    }
    
    return true;
    
  } catch (error) {
    logError('فشل التحقق من رابط الصوت', error);
    return false;
  }
}

// ===== BATCH PROCESSING =====

/**
 * معالجة دفعية: إنشاء أصوات متعددة
 * 
 * @param texts - قائمة النصوص
 * @param baseJobId - معرف أساسي للمهمة
 * @param voiceId - معرف الصوت (اختياري)
 * @returns قائمة روابط الأصوات
 */
export async function createMultipleAudios(
  texts: string[],
  baseJobId: string,
  voiceId?: string
): Promise<string[]> {
  
  logInfo(`بدء معالجة دفعية لـ ${texts.length} نص`);
  
  const audioUrls: string[] = [];
  const errors: string[] = [];
  
  for (let i = 0; i < texts.length; i++) {
    const jobId = `${baseJobId}_${i}`;
    
    try {
      logInfo(`معالجة النص ${i + 1}/${texts.length}...`);
      
      const audioUrl = await createAndSaveAudio(texts[i], jobId, voiceId);
      audioUrls.push(audioUrl);
      
      logInfo(`✓ تم إنشاء الصوت ${i + 1}/${texts.length}`);
      
      // انتظار قصير بين الطلبات لتجنب Rate Limiting
      if (i < texts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logError(`فشل إنشاء الصوت ${i + 1}`, errorMsg);
      errors.push(`النص ${i + 1}: ${errorMsg}`);
      
      // إضافة null للحفاظ على الترتيب
      audioUrls.push('');
    }
  }
  
  if (errors.length > 0) {
    logWarning(`اكتملت المعالجة الدفعية مع ${errors.length} خطأ`, errors);
  } else {
    logInfo(`✓ اكتملت المعالجة الدفعية بنجاح لـ ${texts.length} نص`);
  }
  
  return audioUrls;
}
