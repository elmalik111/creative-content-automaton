import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';

interface AccountInfoProps {
  isLoading: boolean;
  isVerified: boolean | null;
  accountInfo?: {
    name?: string;
    username?: string;
    picture?: string;
    id?: string;
    pages?: Array<{ id: string; name: string; picture?: string }>;
    channel?: { id: string; title: string };
    subscribers?: string;
    subscription?: string;
    character_count?: number;
    character_limit?: number;
  } | null;
  error?: string;
  expiresAt?: string | null;
}

export function AccountInfo({ isLoading, isVerified, accountInfo, error, expiresAt }: AccountInfoProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Verifying...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <XCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  if (isVerified === false) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <XCircle className="h-4 w-4" />
        Invalid token
      </div>
    );
  }

  if (!accountInfo) return null;

  const isExpired = expiresAt && new Date(expiresAt) < new Date();
  const isExpiringSoon = expiresAt && !isExpired && 
    new Date(expiresAt) < new Date(Date.now() + 24 * 60 * 60 * 1000);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {accountInfo.picture && (
          <img 
            src={accountInfo.picture} 
            alt={accountInfo.name || 'Account'} 
            className="h-8 w-8 rounded-full"
          />
        )}
        <div className="flex-1">
          <p className="text-sm font-medium">{accountInfo.name || accountInfo.username}</p>
          {accountInfo.username && accountInfo.name && (
            <p className="text-xs text-muted-foreground">@{accountInfo.username}</p>
          )}
        </div>
        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Verified
        </Badge>
      </div>

      {/* Channel info for YouTube */}
      {accountInfo.channel && (
        <div className="text-xs text-muted-foreground">
          Channel: {accountInfo.channel.title}
          {accountInfo.subscribers && ` • ${parseInt(accountInfo.subscribers).toLocaleString()} subscribers`}
        </div>
      )}

      {/* Pages for Facebook */}
      {accountInfo.pages && accountInfo.pages.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Connected Pages:</p>
          <div className="flex flex-wrap gap-1">
            {accountInfo.pages.slice(0, 3).map((page) => (
              <Badge key={page.id} variant="secondary" className="text-xs">
                {page.name}
              </Badge>
            ))}
            {accountInfo.pages.length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{accountInfo.pages.length - 3} more
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* ElevenLabs quota */}
      {accountInfo.character_limit && (
        <div className="text-xs text-muted-foreground">
          Characters: {(accountInfo.character_count || 0).toLocaleString()} / {accountInfo.character_limit.toLocaleString()}
          {accountInfo.subscription && ` • ${accountInfo.subscription}`}
        </div>
      )}

      {/* Expiration warning */}
      {isExpired && (
        <Badge variant="destructive" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          Token Expired
        </Badge>
      )}
      {isExpiringSoon && !isExpired && (
        <Badge variant="outline" className="bg-accent/50 text-accent-foreground border-accent text-xs">
          <Clock className="h-3 w-3 mr-1" />
          Expires Soon
        </Badge>
      )}
    </div>
  );
}
