/**
 * Audio Helper - حفظ الصوت من ElevenLabs في Supabase
 * يحل مشكلة: "فشل تحميل الملفات: HTTP 400"
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
    // رفع الملف
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(audioFileName, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      });
    
    if (uploadError) {
      logError('فشل رفع الصوت إلى Supabase', uploadError);
      throw new Error(`فشل رفع الصوت: ${uploadError.message}`);
    }
    
    // الحصول على الرابط العام
    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(audioFileName);
    
    if (!publicUrlData || !publicUrlData.publicUrl) {
      throw new Error('فشل الحصول على الرابط العام للصوت');
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
  
  try {
    // 1. إنشاء الصوت من ElevenLabs
    logInfo('الخطوة 1: إنشاء الصوت من ElevenLabs...');
    const audioBuffer = await generateSpeech(text, voiceId);
    
    if (!audioBuffer) {
      throw new Error('فشل إنشاء الصوت من ElevenLabs - لم يُرجع بيانات');
    }
    
    logInfo(`✓ تم إنشاء الصوت (${audioBuffer.byteLength} bytes)`);
    
    // 2. حفظ الصوت في Supabase
    logInfo('الخطوة 2: حفظ الصوت في Supabase...');
    const audioUrl = await saveAudioToStorage(audioBuffer, jobId, bucketName);
    
    logInfo('✓✓✓ اكتمل إنشاء وحفظ الصوت بنجاح ✓✓✓', { audioUrl });
    
    return audioUrl;
    
  } catch (error) {
    logError('فشل إنشاء وحفظ الصوت', error);
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
  mergeServerUrl: string = 'https://osama141-me.hf.space',
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
    textLength: text.length
  });
  
  try {
    // 1. إنشاء وحفظ الصوت
    const audioUrl = await createAndSaveAudio(text, jobId, voiceId);
    
    // 2. بدء عملية الدمج
    logInfo('الخطوة 3: بدء عملية الدمج...', { imageUrl, audioUrl });
    
    const mergeResponse = await fetch(mergeServerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: imageUrl,
        audioUrl: audioUrl,  // ✅ رابط عام من Supabase
      })
    });
    
    if (!mergeResponse.ok) {
      const errorText = await mergeResponse.text();
      throw new Error(`فشل بدء عملية الدمج (HTTP ${mergeResponse.status}): ${errorText}`);
    }
    
    const mergeResult = await mergeResponse.json();
    
    logInfo('✓ تم بدء عملية الدمج بنجاح', mergeResult);
    
    return {
      jobId,
      audioUrl,
      mergeJobId: mergeResult.jobId || mergeResult.job_id,
      status: mergeResult.status || 'processing'
    };
    
  } catch (error) {
    logError('فشلت عملية إنشاء الصوت والدمج', error);
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
    const response = await fetch(audioUrl, { method: 'HEAD' });
    
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
    if (contentType && !contentType.includes('audio')) {
      logError(`نوع المحتوى غير صالح: ${contentType}`);
      return false;
    }
    
    return true;
    
  } catch (error) {
    logError('فشل التحقق من رابط الصوت', error);
    return false;
  }
}
