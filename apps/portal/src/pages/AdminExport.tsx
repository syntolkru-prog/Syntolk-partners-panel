import { appPath } from '../app-path.js';
import { useState } from 'react';
import { FileJson, FileSpreadsheet, Archive, Upload, Database } from 'lucide-react';
import { getApiKey } from '../api.js';
import { theme } from '../theme.js';
import { Button, Card, Page, SectionHeading } from '../ui.js';

// Active tables available for one-off downloads, in FK-safe order.
// Full bundles also preserve legacy data from removed features.
const TABLES = [
  'Partner',
  'PartnerMessage',
  'PartnerMessageAttachment',
  'Program',
  'PartnerProgram',
  'PartnerCommission',
  'Coupon',
  'Link',
  'PartnerMaterial',
  'PartnerLinkSource',
  'Click',
  'Identity',
  'Event',
  'Attribution',
  'Commission',
  'Payout',
  'PortalCustomDomain',
  'CommissionAdjustment',
  'PartnerTermsAcceptance',
];

const TABLE_LABELS: Record<string, string> = {
  Partner: 'Партнёр',
  PartnerMessage: 'Переписка с партнёрами',
  PartnerMessageAttachment: 'Вложения переписки',
  Program: 'Программа',
  PartnerProgram: 'Связь партнёра с программой',
  PartnerCommission: 'Ставка комиссии партнёра',
  Coupon: 'Промокод',
  Link: 'Партнёрская ссылка',
  PartnerMaterial: 'Материалы партнёров',
  PartnerLinkSource: 'Размещения и источники',
  Click: 'Клик',
  Identity: 'Идентификатор',
  Event: 'Событие',
  Attribution: 'Атрибуция',
  Commission: 'Начисление комиссии',
  Payout: 'Выплата',
  PortalCustomDomain: 'Пользовательский домен кабинета',
  CommissionAdjustment: 'Корректировка комиссии',
  PartnerTermsAcceptance: 'Принятие условий партнёром',
};

export function AdminExport() {
  const key = getApiKey() ?? '';

  function download(path: string) {
    fetch(appPath(`/api${path}`), { headers: { Authorization: `Bearer ${key}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path.split('/').pop() ?? 'export';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <Page title="Экспорт / импорт" subtitle="Ваши данные принадлежат вам. В любой момент скачайте партнёров, программы, атрибуцию и реестр операций.">
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Archive size={22} color={theme.accent} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Полный архив</div>
            <div style={{ color: theme.textMuted, fontSize: 13 }}>
              Все экспортируемые таблицы в одном файле. JSON можно восстановить в локальной установке через{' '}
              <code>POST /import</code>; SQL-дамп восстанавливается напрямую через{' '}
              <code>psql -v tenant_id=&lt;ID целевой компании&gt; -f syntolk-export.sql</code>.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button icon={<FileJson size={14} />} onClick={() => download('/export.json')}>
              JSON
            </Button>
            <Button variant="secondary" icon={<Database size={14} />} onClick={() => download('/export.sql')}>
              SQL
            </Button>
          </div>
        </div>
      </Card>

      <SectionHeading>По отдельным таблицам</SectionHeading>
      <Card padded={false}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              {['Table', 'JSON', 'CSV', 'SQL'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '12px 18px',
                    fontWeight: 500,
                    color: theme.textMuted,
                    fontSize: 12,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: `1px solid ${theme.border}`,
                    background: theme.surface2,
                  }}
                >
              {h === 'Table' ? 'Таблица' : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TABLES.map((t, i) => (
              <tr
                key={t}
                style={{
                  borderBottom: i < TABLES.length - 1 ? `1px solid ${theme.borderSubtle}` : 'none',
                }}
              >
                <td style={{ padding: '12px 18px' }}>
                  <span style={{ color: theme.text }}>{TABLE_LABELS[t] ?? t}</span>
                </td>
                <td style={{ padding: '8px 18px' }}>
                  <Button size="sm" variant="ghost" icon={<FileJson size={14} />} onClick={() => download(`/export/${t}.json`)}>
                    JSON
                  </Button>
                </td>
                <td style={{ padding: '8px 18px' }}>
                  <Button size="sm" variant="ghost" icon={<FileSpreadsheet size={14} />} onClick={() => download(`/export/${t}.csv`)}>
                    CSV
                  </Button>
                </td>
                <td style={{ padding: '8px 18px' }}>
                  <Button size="sm" variant="ghost" icon={<Database size={14} />} onClick={() => download(`/export/${t}.sql`)}>
                    SQL
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SectionHeading>Импорт партнёров из CSV</SectionHeading>
      <PartnersCsvImporter />
    </Page>
  );
}

interface ImportReportRow {
  row: number;
  email: string;
  status: 'created' | 'skipped_email_taken' | 'invalid';
  reason?: string;
  partnerId?: string;
}
interface ImportResult {
  dryRun: boolean;
  summary: { total: number; created: number; skipped: number; invalid: number };
  report: ImportReportRow[];
}

function PartnersCsvImporter() {
  const key = getApiKey() ?? '';
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(appPath(`/api/import/partners-csv?dryRun=${dryRun}`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'text/csv' },
        body: csv,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.detail === 'string' ? json.detail : json.error ?? 'Не удалось выполнить импорт');
        setResult(null);
      } else {
        setResult(json as ImportResult);
      }
    } finally {
      setBusy(false);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ''));
    reader.readAsText(f);
  }

  return (
    <Card>
      <p style={{ fontSize: 13, color: theme.textMuted, margin: '0 0 12px' }}>
        Перенесите данные из Impact, Rewardful, Refersion и других систем — приведите экспорт
        к каноническому формату ниже и загрузите его. Операцию можно повторять: существующие
        email будут пропущены, а не продублированы.
      </p>
      <details style={{ marginBottom: 12 }}>
        <summary style={{ fontSize: 13, color: theme.accent, cursor: 'pointer' }}>
          Канонический формат CSV
        </summary>
        <pre style={{ background: theme.surface2, border: `1px solid ${theme.borderSubtle}`, borderRadius: theme.radiusSm, padding: 10, marginTop: 8, fontSize: 12, overflowX: 'auto' }}>
{`email,name,activatedAt,metadata
ada@example.com,Ada Lovelace,2024-01-15T00:00:00Z,"{""source"":""impact""}"
grace@example.com,Grace Hopper,,
`}
        </pre>
        <p style={{ fontSize: 12, color: theme.textMuted, margin: '8px 0 0' }}>
          <code>email</code> + <code>name</code> обязательны. <code>activatedAt</code> по умолчанию
          устанавливается в текущий момент (существующие партнёры импортируются активными).
          <code>metadata</code> — необязательный JSON, объединяемый с Partner.metadata. Новые
          партнёры получают доступ ко всем текущим кампаниям.
        </p>
      </details>
      <label style={{ display: 'inline-block', marginBottom: 8, cursor: 'pointer' }}>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          style={{ display: 'none' }}
          aria-label="Выбрать CSV-файл"
        />
        <span style={{ display: 'inline-block', padding: '7px 12px', border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, color: theme.text, fontSize: 13 }}>
          Выбрать CSV-файл
        </span>
      </label>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={6}
        placeholder="…или вставьте CSV сюда"
        style={{
          width: '100%',
          padding: '10px 12px',
          background: theme.surface2,
          border: `1px solid ${theme.border}`,
          borderRadius: theme.radiusSm,
          color: theme.text,
          fontFamily: theme.fontMono,
          fontSize: 12,
          resize: 'vertical',
          marginBottom: 12,
        }}
      />
      {error && <div style={{ color: theme.danger, fontSize: 13, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Button onClick={() => run(true)} disabled={!csv.trim() || busy} variant="secondary">
          {busy ? 'Выполняем…' : 'Предпросмотр (без записи)'}
        </Button>
        <Button onClick={() => run(false)} disabled={!csv.trim() || busy} icon={<Upload size={14} />}>
          {busy ? 'Импортируем…' : 'Импортировать'}
        </Button>
      </div>
      {result && (
        <div style={{ background: theme.surface2, border: `1px solid ${theme.borderSubtle}`, borderRadius: theme.radiusSm, padding: 12, fontSize: 13 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>{result.dryRun ? 'Предпросмотр' : 'Импорт завершён'}</strong> · строк: {result.summary.total} ·
            <span style={{ color: theme.success, marginLeft: 8 }}>{result.summary.created} создано</span>
            <span style={{ color: theme.textMuted, marginLeft: 8 }}>{result.summary.skipped} пропущено</span>
            {result.summary.invalid > 0 && <span style={{ color: theme.danger, marginLeft: 8 }}>{result.summary.invalid} ошибочных</span>}
          </div>
          {result.report.filter((r) => r.status !== 'created').slice(0, 50).map((r) => (
            <div key={r.row} style={{ fontSize: 12, color: r.status === 'invalid' ? theme.danger : theme.textMuted }}>
              строка {r.row} ({r.email}): {importStatus(r.status)}{r.reason ? ` — ${r.reason}` : ''}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function importStatus(status: ImportReportRow['status']): string {
  if (status === 'created') return 'создано';
  if (status === 'skipped_email_taken') return 'пропущено: email уже занят';
  return 'ошибка';
}
