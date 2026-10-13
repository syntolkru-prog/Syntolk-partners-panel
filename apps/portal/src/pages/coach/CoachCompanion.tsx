import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, currentTenantSlug } from '../../api.js';
import { CoachChat, CoachCreature } from './CoachChat.js';
import './companion.css';

type CompanionMe = {
  enabled: boolean;
  assistant?: {
    name?: string;
    greeting?: string;
    mascotEnabled?: boolean;
  };
};

function invitationKey(partnerId: string, tenantSlug = currentTenantSlug()): string {
  return `syntolk-coach-invitation:${tenantSlug ?? 'default'}:${partnerId}`;
}

function wasInvitationDismissed(partnerId: string, tenantSlug?: string | null): boolean {
  try {
    return sessionStorage.getItem(invitationKey(partnerId, tenantSlug)) === '1';
  } catch {
    return false;
  }
}

function dismissInvitation(partnerId: string, tenantSlug?: string | null): void {
  try {
    sessionStorage.setItem(invitationKey(partnerId, tenantSlug), '1');
  } catch {
    // A blocked sessionStorage should not prevent the coach from opening.
  }
}

/** Partner-only floating entry point. It deliberately does not intercept navigation. */
export function CoachCompanion({ partnerId, prefix = '/coach/me' }: { partnerId: string; prefix?: string }) {
  const panelId = `syntolk-coach-floating-panel-${useId().replace(/:/g, '')}`;
  const titleId = `syntolk-coach-floating-title-${useId().replace(/:/g, '')}`;
  const tenantSlug = currentTenantSlug();
  const [open, setOpen] = useState(false);
  const [invitationVisible, setInvitationVisible] = useState(() => !wasInvitationDismissed(partnerId, tenantSlug));
  const [draft, setDraft] = useState('');
  const me = useQuery({
    queryKey: ['coach', tenantSlug, partnerId, prefix, 'me'],
    queryFn: () => api<CompanionMe>(prefix),
    enabled: Boolean(partnerId),
    staleTime: 30_000,
  });

  useEffect(() => {
    setOpen(false);
    setDraft('');
    setInvitationVisible(!wasInvitationDismissed(partnerId, tenantSlug));
  }, [partnerId, prefix, tenantSlug]);

  useEffect(() => {
    if (me.data && (!me.data.enabled || me.data.assistant?.mascotEnabled === false)) setOpen(false);
  }, [me.data]);

  if (!me.data?.enabled || me.data.assistant?.mascotEnabled === false) return null;

  const name = me.data.assistant?.name || 'Синти';
  const openChat = () => {
    dismissInvitation(partnerId, tenantSlug);
    setInvitationVisible(false);
    setOpen(true);
  };
  const closeChat = () => setOpen(false);
  const dismiss = () => {
    dismissInvitation(partnerId, tenantSlug);
    setInvitationVisible(false);
  };
  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeChat();
    }
  };

  return (
    <div className="syntolk-coach-companion">
      {invitationVisible && !open && (
        <aside className="syntolk-coach-invitation" role="status" aria-label="Приглашение к помощнику">
          <button className="syntolk-coach-invitation__close" type="button" onClick={dismiss} aria-label="Скрыть приглашение">×</button>
          <CoachCreature size={42} />
          <div>
            <strong>{name}</strong>
            <p>Подскажу следующий шаг по партнёрской программе.</p>
            <button className="syntolk-coach-button syntolk-coach-button--link" type="button" onClick={openChat}>Открыть чат</button>
          </div>
        </aside>
      )}

      {open && (
        <section id={panelId} className="syntolk-coach-floating-panel" role="dialog" aria-modal="false" aria-labelledby={titleId} onKeyDown={onPanelKeyDown} tabIndex={-1}>
          <div className="syntolk-coach-floating-panel__bar">
            <span id={titleId}>Помощник</span>
            <button className="syntolk-coach-invitation__close" type="button" onClick={closeChat} aria-label="Закрыть чат">×</button>
          </div>
          <CoachChat partnerId={partnerId} prefix={prefix} draft={draft} onDraftChange={setDraft} />
        </section>
      )}

      <button
        className="syntolk-coach-toggle"
        type="button"
        onClick={open ? closeChat : openChat}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Закрыть помощника' : 'Открыть помощника'}
        title={open ? 'Закрыть помощника' : 'Открыть помощника'}
      >
        <CoachCreature size={44} />
        <span>{open ? 'Закрыть' : 'Помощник'}</span>
      </button>
    </div>
  );
}
