import { ResultsDatePicker } from './ResultsDatePicker.js';
import './results-explorer.css';
import './date-input.css';

export function DateInput({ label, value, onChange, disabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return <div className="date-input">
    <input type="date" aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
    <ResultsDatePicker single allowFuture showQuickActions label={`Открыть календарь: ${label}`} value={{from:value,to:value}} caption="" disabled={disabled} onChange={range => onChange(range.from)} />
  </div>;
}
