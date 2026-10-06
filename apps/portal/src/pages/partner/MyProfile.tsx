import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api.js';
import { Button, Card, ErrorBanner, Input, Label, Page, Textarea } from '../../ui.js';
import { theme } from '../../theme.js';

interface Profile {
  id: string;
  email: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profile: Record<string, unknown> | null;
  createdAt: string;
}

interface ProfileResponse extends Partial<Profile> {
  notFederated?: boolean;
}

export function MyProfilePage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['network-my-profile'],
    queryFn: () => api<ProfileResponse>(`/network/me/profile`),
    retry: false,
  });

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [bio, setBio] = useState('');

  useEffect(() => {
    if (data && !data.notFederated) {
      setName(data.name ?? '');
      setHandle(data.handle ?? '');
      setAvatarUrl(data.avatarUrl ?? '');
      setBio(data.bio ?? '');
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/network/me/profile`, {
        method: 'PATCH',
        body: {
          name: name || undefined,
          handle: handle || null,
          avatarUrl: avatarUrl || null,
          bio: bio || null,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network-my-profile'] }),
  });

  return (
    <Page title="Профиль в сети" subtitle="Так компании видят вас в сети Syntolk.">
      <ErrorBanner error={error} />
      <ErrorBanner error={save.error} />
      {isLoading ? (
        <Card>Загрузка…</Card>
      ) : data?.notFederated ? (
        <Card>
          <div style={{ fontSize: 14 }}>
            Компания ещё не добавила вас в сеть. Попросите администратора включить
            <strong> автоматическое добавление</strong> в разделе «Настройки → Сеть» и запустить <strong>Заполнение профилей</strong>;
            после этого ваш профиль появится здесь.
          </div>
        </Card>
      ) : data ? (
        <Card>
          <div style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
            <div>
              <Label>Электронная почта</Label>
              <Input value={data.email} disabled readOnly />
              <p style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>Электронная почта используется как ключ подключения и здесь не изменяется.</p>
            </div>
            <div>
              <Label>Отображаемое имя</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Идентификатор</Label>
              <Input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="your-handle"
              />
              <p style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>Используется как идентификатор ваших партнёрских ссылок.</p>
            </div>
            <div>
              <Label>URL аватара</Label>
              <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <Label>О себе</Label>
              <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} />
            </div>
            <div>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Сохраняем…' : save.isSuccess ? 'Сохранено' : 'Сохранить изменения'}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </Page>
  );
}
