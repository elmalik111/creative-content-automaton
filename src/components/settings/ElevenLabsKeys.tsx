import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  useElevenLabsKeys, 
  useAddElevenLabsKey, 
  useRemoveElevenLabsKey,
  useToggleElevenLabsKey 
} from '@/hooks/useElevenLabsKeys';
import { supabase } from '@/integrations/supabase/client';
import { Key, Plus, Trash2, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface VerificationResult {
  valid: boolean;
  subscription?: string;
  character_count?: number;
  character_limit?: number;
  error?: string;
}

export function ElevenLabsKeys() {
  const { data: keys, isLoading } = useElevenLabsKeys();
  const addKey = useAddElevenLabsKey();
  const removeKey = useRemoveElevenLabsKey();
  const toggleKey = useToggleElevenLabsKey();
  
  const [isOpen, setIsOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null);
  const [verificationResults, setVerificationResults] = useState<Record<string, VerificationResult>>({});

  const handleAddKey = async () => {
    if (!newKeyName.trim() || !newApiKey.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    try {
      await addKey.mutateAsync({ name: newKeyName, apiKey: newApiKey });
      toast.success('API key added successfully');
      setNewKeyName('');
      setNewApiKey('');
      setIsOpen(false);
    } catch {
      toast.error('Failed to add API key');
    }
  };

  const handleRemoveKey = async (id: string) => {
    try {
      await removeKey.mutateAsync(id);
      setVerificationResults(prev => {
        const newResults = { ...prev };
        delete newResults[id];
        return newResults;
      });
      toast.success('API key removed');
    } catch {
      toast.error('Failed to remove API key');
    }
  };

  const handleToggleKey = async (id: string, isActive: boolean) => {
    try {
      await toggleKey.mutateAsync({ id, isActive });
      toast.success(isActive ? 'Key activated' : 'Key deactivated');
    } catch {
      toast.error('Failed to update key status');
    }
  };

  const handleVerifyKey = async (id: string, apiKey: string) => {
    setVerifyingKey(id);
    try {
      const { data, error } = await supabase.functions.invoke('verify-tokens', {
        body: { platform: 'elevenlabs', token: apiKey },
      });

      if (error) throw error;

      setVerificationResults(prev => ({
        ...prev,
        [id]: {
          valid: data.valid,
          subscription: data.account_info?.subscription,
          character_count: data.account_info?.character_count,
          character_limit: data.account_info?.character_limit,
          error: data.error,
        },
      }));

      if (data.valid) {
        toast.success('API key verified successfully');
      } else {
        toast.error(data.error || 'Verification failed');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setVerificationResults(prev => ({
        ...prev,
        [id]: { valid: false, error: error.message },
      }));
      toast.error(error.message);
    } finally {
      setVerifyingKey(null);
    }
  };

  const maskApiKey = (key: string) => {
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 4)}${'•'.repeat(8)}${key.slice(-4)}`;
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Key className="h-5 w-5" />
          ElevenLabs API Keys (Auto-Rotation)
        </CardTitle>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Key
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card">
            <DialogHeader>
              <DialogTitle>Add New ElevenLabs Key</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Key Name</Label>
                <Input
                  id="key-name"
                  placeholder="e.g., Key 1, Production, etc."
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder="sk-..."
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  className="bg-background"
                />
              </div>
              <Button 
                onClick={handleAddKey} 
                disabled={addKey.isPending}
                className="w-full"
              >
                {addKey.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Add Key
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-14 bg-muted animate-pulse rounded" />
            <div className="h-14 bg-muted animate-pulse rounded" />
          </div>
        ) : keys && keys.length > 0 ? (
          <div className="space-y-2">
            {keys.map((key) => {
              const verification = verificationResults[key.id];
              
              return (
                <div
                  key={key.id}
                  className="p-3 rounded-lg bg-muted/50 border border-border space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={key.is_active}
                        onCheckedChange={(checked) => handleToggleKey(key.id, checked)}
                      />
                      <div>
                        <p className="font-medium text-foreground">{key.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {maskApiKey(key.api_key)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        Uses: {key.usage_count}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleVerifyKey(key.id, key.api_key)}
                        disabled={verifyingKey === key.id}
                      >
                        {verifyingKey === key.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Verify'
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveKey(key.id)}
                        disabled={removeKey.isPending}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Verification result */}
                  {verification && (
                    <div className={`p-2 rounded text-xs ${verification.valid ? 'bg-primary/5' : 'bg-destructive/5'}`}>
                      {verification.valid ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-primary" />
                            Valid
                          </span>
                          {verification.subscription && (
                            <Badge variant="secondary" className="text-xs">
                              {verification.subscription}
                            </Badge>
                          )}
                          {verification.character_limit && (
                            <span className="text-muted-foreground">
                              {(verification.character_count || 0).toLocaleString()} / {verification.character_limit.toLocaleString()} chars
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="flex items-center gap-1 text-destructive">
                          <XCircle className="h-3 w-3" />
                          {verification.error}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <Key className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No API keys added yet</p>
            <p className="text-sm">Add keys to enable auto-rotation</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
