import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing authentication...');
  const [channelInfo, setChannelInfo] = useState<{ name: string; picture?: string } | null>(null);

  useEffect(() => {
    const processCallback = async () => {
      const code = searchParams.get('code');
      const error = searchParams.get('error');

      if (error) {
        setStatus('error');
        setMessage(`Authentication failed: ${error}`);
        return;
      }

      if (!code) {
        setStatus('error');
        setMessage('No authorization code received');
        return;
      }

      try {
        // Exchange code for tokens
        const { data, error: invokeError } = await supabase.functions.invoke('google-auth', {
          body: { 
            code, 
            redirect_uri: `${window.location.origin}/auth/callback` 
          },
        });

        if (invokeError) {
          throw new Error(invokeError.message);
        }

        if (data.error) {
          throw new Error(data.error);
        }

        setStatus('success');
        setMessage('YouTube connected successfully!');
        setChannelInfo(data.channel);

        // Redirect after success
        setTimeout(() => {
          navigate('/', { replace: true });
        }, 3000);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('Callback error:', error);
        setStatus('error');
        setMessage(error.message);
      }
    };

    processCallback();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            {status === 'loading' && <Loader2 className="h-6 w-6 animate-spin text-primary" />}
            {status === 'success' && <CheckCircle2 className="h-6 w-6 text-primary" />}
            {status === 'error' && <XCircle className="h-6 w-6 text-destructive" />}
            {status === 'loading' && 'Connecting...'}
            {status === 'success' && 'Connected!'}
            {status === 'error' && 'Connection Failed'}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-muted-foreground">{message}</p>
          
          {channelInfo && (
            <div className="flex items-center justify-center gap-3 p-3 bg-secondary rounded-lg">
              {channelInfo.picture && (
                <img 
                  src={channelInfo.picture}
                  alt={channelInfo.name} 
                  className="h-10 w-10 rounded-full"
                />
              )}
              <span className="font-medium">{channelInfo.name}</span>
            </div>
          )}

          {status === 'success' && (
            <p className="text-sm text-muted-foreground">
              Redirecting to dashboard...
            </p>
          )}

          {status === 'error' && (
            <Button onClick={() => navigate('/', { replace: true })}>
              Back to Dashboard
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
