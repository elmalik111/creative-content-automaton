import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { Upload, Image, Music, Loader2, CheckCircle2, X } from 'lucide-react';
import { toast } from 'sonner';

interface FileUploaderProps {
  onUploadComplete: (imageUrl: string, audioUrl: string) => void;
}

export function FileUploader({ onUploadComplete }: FileUploaderProps) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File, bucket: string): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `uploads/${fileName}`;

    const { error } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  };

  const handleUpload = async () => {
    if (!imageFile && !audioFile) {
      toast.error('Please select at least one file to upload');
      return;
    }

    setIsUploading(true);

    try {
      let uploadedImageUrl = imageUrl;
      let uploadedAudioUrl = audioUrl;

      if (imageFile) {
        uploadedImageUrl = await uploadFile(imageFile, 'media-input');
        setImageUrl(uploadedImageUrl);
        toast.success('Image uploaded successfully');
      }

      if (audioFile) {
        uploadedAudioUrl = await uploadFile(audioFile, 'media-input');
        setAudioUrl(uploadedAudioUrl);
        toast.success('Audio uploaded successfully');
      }

      onUploadComplete(uploadedImageUrl, uploadedAudioUrl);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      toast.error(`Upload failed: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file');
        return;
      }
      setImageFile(file);
      setImageUrl('');
    }
  };

  const handleAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('audio/')) {
        toast.error('Please select an audio file');
        return;
      }
      setAudioFile(file);
      setAudioUrl('');
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImageUrl('');
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const clearAudio = () => {
    setAudioFile(null);
    setAudioUrl('');
    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  return (
    <div className="space-y-4 p-4 rounded-lg bg-muted/30 border border-border">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Upload className="h-4 w-4" />
        Upload Files to Supabase Storage
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Image Upload */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Image className="h-4 w-4 text-primary" />
            Image File
          </Label>
          <div className="flex gap-2">
            <Input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="bg-background text-xs"
            />
            {imageFile && (
              <Button variant="ghost" size="icon" onClick={clearImage}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {imageFile && (
            <p className="text-xs text-muted-foreground truncate">
              {imageFile.name} ({(imageFile.size / 1024).toFixed(1)} KB)
            </p>
          )}
          {imageUrl && (
            <div className="flex items-center gap-1 text-xs text-primary">
              <CheckCircle2 className="h-3 w-3" />
              Uploaded
            </div>
          )}
        </div>

        {/* Audio Upload */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Music className="h-4 w-4 text-primary" />
            Audio File
          </Label>
          <div className="flex gap-2">
            <Input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              onChange={handleAudioSelect}
              className="bg-background text-xs"
            />
            {audioFile && (
              <Button variant="ghost" size="icon" onClick={clearAudio}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {audioFile && (
            <p className="text-xs text-muted-foreground truncate">
              {audioFile.name} ({(audioFile.size / 1024).toFixed(1)} KB)
            </p>
          )}
          {audioUrl && (
            <div className="flex items-center gap-1 text-xs text-primary">
              <CheckCircle2 className="h-3 w-3" />
              Uploaded
            </div>
          )}
        </div>
      </div>

      <Button
        onClick={handleUpload}
        disabled={isUploading || (!imageFile && !audioFile)}
        size="sm"
        className="w-full"
      >
        {isUploading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-2" />
            Upload & Use URLs
          </>
        )}
      </Button>

      {(imageUrl || audioUrl) && (
        <div className="space-y-2 text-xs">
          {imageUrl && (
            <div className="p-2 rounded bg-background border border-border">
              <span className="text-muted-foreground">Image URL: </span>
              <code className="text-primary break-all">{imageUrl}</code>
            </div>
          )}
          {audioUrl && (
            <div className="p-2 rounded bg-background border border-border">
              <span className="text-muted-foreground">Audio URL: </span>
              <code className="text-primary break-all">{audioUrl}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
