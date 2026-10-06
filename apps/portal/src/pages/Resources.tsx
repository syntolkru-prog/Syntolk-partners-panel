import { useQuery } from '@tanstack/react-query';
import { Download, Image as ImageIcon, Megaphone } from 'lucide-react';
import { api } from '../api.js';
import { theme } from '../theme.js';
import { Card, EmptyState, ErrorBanner, Page } from '../ui.js';

interface ResourceResponse {
  brand: { displayName: string | null; logoUrl: string | null; brandColor: string | null; supportEmail: string | null };
  assets: Array<{ id: string; kind: 'image' | 'snippet' | 'document'; label: string; description: string | null; body: string | null; url: string | null }>;
}

/** Partner-facing Syntolk marketing kit. The same data is editable by the
 * admin in Settings and readable here without exposing tenant internals. */
export function ResourcesPage() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['partner-brand-resources'],
    queryFn: () => api<ResourceResponse>('/brand-resources'),
  });
  const brand = data?.brand;
  const assets = data?.assets ?? [];

  return (
    <Page title="Материалы для продвижения" subtitle={brand?.displayName ? `Готовые материалы ${brand.displayName}` : 'Логотипы, тексты и ссылки для публикаций'}>
      <ErrorBanner error={error} />
      {isLoading ? <Card>Загрузка…</Card> : assets.length === 0 && !brand?.logoUrl ? (
        <EmptyState title="Материалов пока нет" hint="Администратор Syntolk сможет добавить их в настройках программы." icon={<Megaphone size={28} strokeWidth={1.25} />} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(brand?.logoUrl || brand?.brandColor) && (
            <Card>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Бренд Syntolk</div>
              <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                {brand.logoUrl && <img src={brand.logoUrl} alt="Логотип Syntolk" style={{ width: 88, height: 88, objectFit: 'contain', padding: 8, background: theme.surface2, borderRadius: theme.radiusSm }} />}
                {brand.brandColor && <code style={{ color: brand.brandColor }}>{brand.brandColor}</code>}
              </div>
            </Card>
          )}
          {assets.map((asset) => (
            <Card key={asset.id}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {asset.kind === 'image' ? <ImageIcon size={18} color={theme.accent} /> : <Megaphone size={18} color={theme.accent} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{asset.label}</div>
                  {asset.description && <div style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>{asset.description}</div>}
                  {asset.body && <pre style={{ whiteSpace: 'pre-wrap', color: theme.text, fontFamily: theme.fontSans, fontSize: 13, lineHeight: 1.55, margin: '12px 0 0' }}>{asset.body}</pre>}
                  {asset.url && <a href={asset.url} target="_blank" rel="noreferrer noopener" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: theme.accent, fontSize: 13, marginTop: 10 }}><Download size={14} /> Скачать / открыть</a>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
