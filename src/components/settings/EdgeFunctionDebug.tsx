import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { Bug, RefreshCw, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface DebugLog {
  function_name: string;
  timestamp: string;
  method: string;
  status: number;
  duration_ms: number;
  request?: unknown;
  response?: unknown;
  error?: string;
}

const FUNCTIONS = ['google-auth', 'verify-tokens', 'merge-media', 'test-publish', 'ai-generate'];

export function EdgeFunctionDebug() {
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFunction, setSelectedFunction] = useState<string>('all');
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; latency: number }>>({});

  const testFunction = async (funcName: string) => {
    const startTime = Date.now();
    try {
      let result;
      
      switch (funcName) {
        case 'google-auth':
          result = await fetch(
            `https://cidxcujlfkrzvvmljxqs.supabase.co/functions/v1/google-auth?action=auth_url&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/callback')}`
          );
          break;
        case 'verify-tokens':
          result = await supabase.functions.invoke('verify-tokens', {
            body: { platform: 'telegram' },
          });
          break;
        case 'merge-media':
          result = await supabase.functions.invoke('merge-media', {
            body: { test: true },
          });
          break;
        case 'test-publish':
          result = await supabase.functions.invoke('test-publish', {
            // Facebook text post is the simplest end-to-end publish test (no image required)
            body: { platform: 'facebook', type: 'text', content: 'اختبار نشر - Facebook' },
          });
          break;
        case 'ai-generate':
          result = await supabase.functions.invoke('ai-generate', {
            body: { test: true },
          });
          break;
        default:
          throw new Error('Unknown function');
      }

      const latency = Date.now() - startTime;
      const success = result instanceof Response ? result.ok : !result.error;

      const status =
        result instanceof Response
          ? result.status
          : result.error
            ? ((result.error as unknown as { context?: { status?: number } }).context?.status ?? 500)
            : 200;

      const responsePayload =
        result instanceof Response
          ? await result.json().catch(() => ({}))
          : result.error
            ? {
                name: result.error.name,
                message: result.error.message,
                context: (result.error as unknown as { context?: unknown }).context,
              }
            : result.data;

      setTestResults(prev => ({
        ...prev,
        [funcName]: { success, message: success ? 'OK' : 'Failed', latency },
      }));

      // Add to logs
      const newLog: DebugLog = {
        function_name: funcName,
        timestamp: new Date().toISOString(),
        method: 'POST',
        status,
        duration_ms: latency,
        response: responsePayload,
      };

      setLogs(prev => [newLog, ...prev.slice(0, 49)]);

      if (success) {
        toast.success(`${funcName} is responding (${latency}ms)`);
      } else {
        toast.error(`${funcName} failed`);
      }
    } catch (err) {
      const latency = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));
      
      setTestResults(prev => ({
        ...prev,
        [funcName]: { success: false, message: error.message, latency },
      }));

      setLogs(prev => [{
        function_name: funcName,
        timestamp: new Date().toISOString(),
        method: 'POST',
        status: 500,
        duration_ms: latency,
        error: error.message,
      }, ...prev.slice(0, 49)]);

      toast.error(`${funcName}: ${error.message}`);
    }
  };

  const testAllFunctions = async () => {
    setIsLoading(true);
    for (const func of FUNCTIONS) {
      await testFunction(func);
    }
    setIsLoading(false);
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'bg-green-500/10 text-green-500 border-green-500/20';
    if (status >= 400 && status < 500) return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
    return 'bg-red-500/10 text-red-500 border-red-500/20';
  };

  const filteredLogs = selectedFunction === 'all' 
    ? logs 
    : logs.filter(log => log.function_name === selectedFunction);

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Bug className="h-5 w-5" />
            Edge Functions Debug
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={testAllFunctions}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Test All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Function Status Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {FUNCTIONS.map((func) => {
            const result = testResults[func];
            return (
              <Button
                key={func}
                variant="outline"
                size="sm"
                className="flex flex-col h-auto py-2 px-3"
                onClick={() => testFunction(func)}
              >
                <span className="text-xs font-medium truncate w-full">{func}</span>
                {result && (
                  <div className="flex items-center gap-1 mt-1">
                    {result.success ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500" />
                    )}
                    <span className="text-[10px] text-muted-foreground">{result.latency}ms</span>
                  </div>
                )}
              </Button>
            );
          })}
        </div>

        {/* Logs Section */}
        <Tabs defaultValue="all" onValueChange={setSelectedFunction}>
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            {FUNCTIONS.slice(0, 5).map((func) => (
              <TabsTrigger key={func} value={func} className="text-xs truncate">
                {func.split('-')[0]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={selectedFunction} className="mt-4">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No logs yet. Click a function to test it.
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {filteredLogs.map((log, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg bg-muted/50 border border-border"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {log.function_name}
                        </Badge>
                        <Badge variant="outline" className={getStatusColor(log.status)}>
                          {log.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {log.duration_ms}ms
                        <span>•</span>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </div>
                    </div>

                    {log.error && (
                      <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-400 mb-2">
                        Error: {log.error}
                      </div>
                    )}

                    {log.response && (
                      <pre className="p-2 rounded bg-background text-xs font-mono overflow-x-auto max-h-[150px]">
                        {JSON.stringify(log.response, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
