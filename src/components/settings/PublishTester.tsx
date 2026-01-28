import { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { FileUploader } from './FileUploader';
import { Share2, Loader2, CheckCircle2, XCircle, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

type Platform = 'youtube' | 'facebook' | 'instagram';

export function PublishTester() {
  const [platform, setPlatform] = useState<Platform>('facebook');
  const [content, setContent] = useState('اختبار نشر من النظام');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<{ ok: boolean; body: unknown } | null>(null);

  const requestBody = useMemo(() => {
    // Facebook: text only by default
    if (platform === 'facebook') {
      return { platform, type: 'text', content };
    }
    // Instagram: needs an image (function also has a safe default if omitted)
    if (platform === 'instagram') {
      return { platform, type: 'image', content, image_url: imageUrl || undefined };
    }
    // YouTube: connection check (not a community post)
    return { platform, type: 'text', content };
  }, [platform, content, imageUrl]);

  const handleUploadComplete = useCallback((uploadedImageUrl: string) => {
    if (uploadedImageUrl) setImageUrl(uploadedImageUrl);
  }, []);

  const testPublish = async () => {
    setIsLoading(true);
    setResponse(null);
    try {
      const result = await supabase.functions.invoke('test-publish', {
        body: requestBody,
      });

      if (result.error) {
        setResponse({
          ok: false,
          body: {
            name: result.error.name,
            message: result.error.message,
            context: (result.error as unknown as { context?: unknown }).context,
          },
        });
        return;
      }

      setResponse({ ok: true, body: result.data });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Share2 className="h-5 w-5" />
          Test Publish
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">المنصة</label>
          <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
            <SelectTrigger>
              <SelectValue placeholder="اختر منصة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="facebook">Facebook (جملة)</SelectItem>
              <SelectItem value="instagram">Instagram (صورة)</SelectItem>
              <SelectItem value="youtube">YouTube (تحقق اتصال)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">المحتوى</label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[90px] bg-background"
          />
        </div>

        {platform === 'instagram' && (
          <>
            <Collapsible open={isUploadOpen} onOpenChange={setIsUploadOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    رفع صورة للاختبار (اختياري)
                  </span>
                  {isUploadOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <FileUploader
                  onUploadComplete={(img) => handleUploadComplete(img)}
                />
              </CollapsibleContent>
            </Collapsible>

            {imageUrl && (
              <div className="text-xs text-muted-foreground">
                Image URL: <span className="font-mono break-all">{imageUrl}</span>
              </div>
            )}
          </>
        )}

        <Button onClick={testPublish} disabled={isLoading} className="w-full">
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              جارٍ الاختبار...
            </>
          ) : (
            'اختبار النشر'
          )}
        </Button>

        {response && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">النتيجة:</span>
              <Badge variant={response.ok ? 'default' : 'destructive'}>
                {response.ok ? (
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                ) : (
                  <XCircle className="h-3 w-3 mr-1" />
                )}
                {response.ok ? 'OK' : 'Failed'}
              </Badge>
            </div>
            <pre className="p-3 rounded-lg bg-muted/50 border border-border text-xs font-mono overflow-auto max-h-[220px]">
              {JSON.stringify(response.body, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
