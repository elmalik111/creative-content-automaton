import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  useApiKeys, 
  useCreateApiKey, 
  useToggleApiKey,
  useDeleteApiKey 
} from '@/hooks/useApiKeys';
import { KeyRound, Plus, Trash2, Loader2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Alert,
  AlertDescription,
} from '@/components/ui/alert';

export function ApiKeysSettings() {
  const { data: keys, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const toggleKey = useToggleApiKey();
  const deleteKey = useDeleteApiKey();
  
  const [isOpen, setIsOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      toast.error('Please enter a key name');
      return;
    }

    try {
      const key = await createKey.mutateAsync(newKeyName);
      setNewlyCreatedKey(key);
      setNewKeyName('');
      toast.success('API key created');
    } catch {
      toast.error('Failed to create API key');
    }
  };

  const handleDeleteKey = async (id: string) => {
    try {
      await deleteKey.mutateAsync(id);
      toast.success('API key deleted');
    } catch {
      toast.error('Failed to delete API key');
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

  const copyToClipboard = async (key: string, id: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKeyId(id);
      setTimeout(() => setCopiedKeyId(null), 2000);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy');
    }
  };

  const maskKey = (key: string) => {
    if (key.length <= 12) return '••••••••••••';
    return `${key.slice(0, 8)}${'•'.repeat(16)}${key.slice(-4)}`;
  };

  const closeDialog = () => {
    setIsOpen(false);
    setNewlyCreatedKey(null);
    setNewKeyName('');
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-foreground">
          <KeyRound className="h-5 w-5" />
          External API Keys
        </CardTitle>
        <Dialog open={isOpen} onOpenChange={(open) => {
          if (!open) closeDialog();
          else setIsOpen(true);
        }}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Create Key
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card">
            <DialogHeader>
              <DialogTitle>Create New API Key</DialogTitle>
            </DialogHeader>
            {newlyCreatedKey ? (
              <div className="space-y-4">
                <Alert className="bg-green-500/10 border-green-500/20">
                  <AlertDescription className="text-green-500">
                    Your API key has been created. Copy it now – you won't be able to see it again!
                  </AlertDescription>
                </Alert>
                <div className="flex gap-2">
                  <Input
                    value={newlyCreatedKey}
                    readOnly
                    className="bg-background font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    onClick={() => copyToClipboard(newlyCreatedKey, 'new')}
                  >
                    {copiedKeyId === 'new' ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Button onClick={closeDialog} className="w-full">
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="key-name">Key Name</Label>
                  <Input
                    id="key-name"
                    placeholder="e.g., Production, Testing, etc."
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="bg-background"
                  />
                </div>
                <Button 
                  onClick={handleCreateKey} 
                  disabled={createKey.isPending || !newKeyName.trim()}
                  className="w-full"
                >
                  {createKey.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Create Key
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="mb-4 p-3 rounded-lg bg-muted/50 border border-border text-sm text-muted-foreground">
          <p className="font-medium mb-1">API Endpoint:</p>
          <code className="text-xs bg-background px-2 py-1 rounded">
            POST https://cidxcujlfkrzvvmljxqs.supabase.co/functions/v1/merge-media
          </code>
          <p className="mt-2 text-xs">Include header: <code className="bg-background px-1 rounded">X-API-Key: your_key</code></p>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <div className="h-14 bg-muted animate-pulse rounded" />
            <div className="h-14 bg-muted animate-pulse rounded" />
          </div>
        ) : keys && keys.length > 0 ? (
          <div className="space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border"
              >
                <div className="flex items-center gap-3">
                  <Switch
                    checked={key.is_active}
                    onCheckedChange={(checked) => handleToggleKey(key.id, checked)}
                  />
                  <div>
                    <p className="font-medium text-foreground">{key.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {maskKey(key.key)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-xs">
                    Uses: {key.usage_count}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(key.key, key.id)}
                  >
                    {copiedKeyId === key.id ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteKey(key.id)}
                    disabled={deleteKey.isPending}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <KeyRound className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No API keys created yet</p>
            <p className="text-sm">Create keys to allow external access</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
