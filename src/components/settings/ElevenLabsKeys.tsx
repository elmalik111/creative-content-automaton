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
import { Key, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

export function ElevenLabsKeys() {
  const { data: keys, isLoading } = useElevenLabsKeys();
  const addKey = useAddElevenLabsKey();
  const removeKey = useRemoveElevenLabsKey();
  const toggleKey = useToggleElevenLabsKey();
  
  const [isOpen, setIsOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');

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
                      {maskApiKey(key.api_key)}
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
                    onClick={() => handleRemoveKey(key.id)}
                    disabled={removeKey.isPending}
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
            <Key className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No API keys added yet</p>
            <p className="text-sm">Add keys to enable auto-rotation</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
