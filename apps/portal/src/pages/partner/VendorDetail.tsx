import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Card, ErrorBanner, Page } from '../../ui.js';
import { theme } from '../../theme.js';

interface Vendor {
  id: string;
  displayName: string;
  instanceUrl: string;
  status: string;
  partnerCount: number;
  description?: string | null;
  websiteUrl?: string | null;
  createdAt: string;
}

export function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['network-vendor', id],
    queryFn: () => api<Vendor>(`/network/vendors/${id}`),
    enabled: !!id,
    retry: false,
  });

  return (
    <Page title={data?.displayName ?? 'Компания'} subtitle="Участник сети">
      <ErrorBanner error={error} />
      {isLoading && <Card>Загрузка…</Card>}
      {data && (
        <Card>
          <div style={{ color: theme.textMuted, fontSize: 13 }}>{data.partnerCount} {data.partnerCount === 1 ? 'партнёр' : 'партнёров'}</div>
          {data.description && <p style={{ marginTop: 12 }}>{data.description}</p>}
          {data.websiteUrl && (
            <p style={{ marginTop: 12 }}>
              <a href={data.websiteUrl} target="_blank" rel="noopener noreferrer">
                Открыть сайт →
              </a>
            </p>
          )}
        </Card>
      )}
    </Page>
  );
}
