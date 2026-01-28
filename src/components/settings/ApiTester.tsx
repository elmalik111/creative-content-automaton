import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApiKeys } from '@/hooks/useApiKeys';
import { FlaskConical, Play, Loader2, CheckCircle2, XCircle, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { FileUploader } from './FileUploader';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { JobTracker } from './JobTracker';

const SUPABASE_URL = "https://cidxcujlfkrzvvmljxqs.supabase.co";

const DEFAULT_REQUEST_BODY = JSON.stringify({
  // استخدم روابط حقيقية من Storage - لا تستخدم placeholder URLs
  imageUrl: "",
  audioUrl: "",
  callback_url: ""
}, null, 2);

export function ApiTester() {
  const { data: apiKeys } = useApiKeys();
  const [selectedKeyId, setSelectedKeyId] = useState<string>('');
  const [requestBody, setRequestBody] = useState(DEFAULT_REQUEST_BODY);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [trackedJobId, setTrackedJobId] = useState<string>('');
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    body: unknown;
  } | null>(null);

  const activeKeys = apiKeys?.filter(k => k.is_active) || [];
  const selectedKey = activeKeys.find(k => k.id === selectedKeyId);

  const handleUploadComplete = useCallback((imageUrl: string, audioUrl: string) => {
    try {
      const currentBody = JSON.parse(requestBody);
      const updatedBody = {
        ...currentBody,
        imageUrl: imageUrl || currentBody.imageUrl,
        audioUrl: audioUrl || currentBody.audioUrl,
      };
      setRequestBody(JSON.stringify(updatedBody, null, 2));
    } catch {
      // If current body is invalid JSON, create new one
      setRequestBody(JSON.stringify({
        imageUrl,
        audioUrl,
        callback_url: "https://your-site.com/webhook"
      }, null, 2));
    }
  }, [requestBody]);

  const isValidHttpsUrl = (url: string): boolean => {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && !url.includes('YOUR_') && !url.includes('placeholder');
    } catch {
      return false;
    }
  };

  const handleTest = async () => {
    if (!selectedKey) return;

    setIsLoading(true);
    setResponse(null);

    try {
      let parsedBody;
      try {
        parsedBody = JSON.parse(requestBody);
      } catch {
        setResponse({
          status: 400,
          statusText: 'Bad Request',
          body: { error: 'Invalid JSON in request body' },
        });
        setIsLoading(false);
        return;
      }

      // Validate URLs before sending
      const imageUrl = parsedBody.imageUrl || parsedBody.image_url || (parsedBody.images?.[0]);
      const audioUrl = parsedBody.audioUrl || parsedBody.audio_url || parsedBody.audio;

      if (!isValidHttpsUrl(imageUrl)) {
        setResponse({
          status: 400,
          statusText: 'Bad Request',
          body: { error: 'يجب إدخال رابط صورة حقيقي من Storage (يبدأ بـ https). استخدم "Upload Files" لرفع الملفات أولاً.' },
        });
        setIsLoading(false);
        return;
      }

      if (!isValidHttpsUrl(audioUrl)) {
        setResponse({
          status: 400,
          statusText: 'Bad Request',
          body: { error: 'يجب إدخال رابط صوت حقيقي من Storage (يبدأ بـ https). استخدم "Upload Files" لرفع الملفات أولاً.' },
        });
        setIsLoading(false);
        return;
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/merge-media`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': selectedKey.key,
        },
        body: JSON.stringify(parsedBody),
      });

      const text = await res.text();
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        // keep as text
      }

      // If a job was created, start tracking it
      if (res.ok && typeof data === 'object' && data && 'job_id' in (data as Record<string, unknown>)) {
        const jobId = (data as Record<string, unknown>).job_id;
        if (typeof jobId === 'string' && jobId.length > 0) {
          setTrackedJobId(jobId);
        }
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        body: data,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setResponse({
        status: 0,
        statusText: 'Network Error',
        body: { error: error.message },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'bg-green-500/10 text-green-500 border-green-500/20';
    if (status >= 400 && status < 500) return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
    return 'bg-red-500/10 text-red-500 border-red-500/20';
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <FlaskConical className="h-5 w-5" />
          API Testing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-sm font-medium text-foreground mb-1">
            Endpoint: <code className="text-xs bg-background px-1.5 py-0.5 rounded">POST /functions/v1/merge-media</code>
          </p>
          <p className="text-xs text-muted-foreground">
            ارفع صورة + صوت من "Upload Files" (Public URLs) ثم اضغط Test — وسيظهر تتبّع العملية خطوة بخطوة.
          </p>
        </div>

        {trackedJobId && (
          <JobTracker jobId={trackedJobId} onStopTracking={() => setTrackedJobId('')} />
        )}

        {/* File Upload Section */}
        <Collapsible open={isUploadOpen} onOpenChange={setIsUploadOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <span className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload Files to Storage
              </span>
              {isUploadOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <FileUploader onUploadComplete={handleUploadComplete} />
          </CollapsibleContent>
        </Collapsible>

        <div className="space-y-2">
          <label className="text-sm font-medium">API Key</label>
          <Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
            <SelectTrigger>
              <SelectValue placeholder="Select an API key" />
            </SelectTrigger>
            <SelectContent>
              {activeKeys.length === 0 ? (
                <SelectItem value="none" disabled>
                  No active API keys
                </SelectItem>
              ) : (
                activeKeys.map((key) => (
                  <SelectItem key={key.id} value={key.id}>
                    {key.name} ({key.key.slice(0, 12)}...)
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Request Body (JSON)</label>
          <Textarea
            value={requestBody}
            onChange={(e) => setRequestBody(e.target.value)}
            className="font-mono text-xs min-h-[150px] bg-background"
            placeholder='{"images": [...], "audio": "..."}'
          />
        </div>

        <Button
          onClick={handleTest}
          disabled={isLoading || !selectedKeyId}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Testing...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Test API
            </>
          )}
        </Button>

        {response && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Response:</span>
              <Badge variant="outline" className={getStatusColor(response.status)}>
                {response.status === 0 ? (
                  <XCircle className="h-3 w-3 mr-1" />
                ) : response.status < 300 ? (
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                ) : (
                  <XCircle className="h-3 w-3 mr-1" />
                )}
                {response.status} {response.statusText}
              </Badge>
            </div>
            <pre className="p-3 rounded-lg bg-muted/50 border border-border text-xs font-mono overflow-auto max-h-[200px]">
              {JSON.stringify(response.body, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
