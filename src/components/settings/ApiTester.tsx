import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApiKeys } from '@/hooks/useApiKeys';
import { FlaskConical, Play, Loader2, CheckCircle2, XCircle } from 'lucide-react';

const SUPABASE_URL = "https://cidxcujlfkrzvvmljxqs.supabase.co";

const DEFAULT_REQUEST_BODY = JSON.stringify({
  images: ["https://example.com/image1.jpg", "https://example.com/image2.jpg"],
  audio: "https://example.com/audio.mp3",
  callback_url: "https://your-site.com/webhook"
}, null, 2);

export function ApiTester() {
  const { data: apiKeys } = useApiKeys();
  const [selectedKeyId, setSelectedKeyId] = useState<string>('');
  const [requestBody, setRequestBody] = useState(DEFAULT_REQUEST_BODY);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    body: unknown;
  } | null>(null);

  const activeKeys = apiKeys?.filter(k => k.is_active) || [];
  const selectedKey = activeKeys.find(k => k.id === selectedKeyId);

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

      const res = await fetch(`${SUPABASE_URL}/functions/v1/merge-media`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': selectedKey.key,
        },
        body: JSON.stringify(parsedBody),
      });

      const data = await res.json();

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
            Test your API keys by sending a request to the merge-media endpoint
          </p>
        </div>

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
