import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DAY_KEYS,
  parseHours,
  serializeHours,
  type DayKey,
  type WeekHours,
} from '../../utils/hours';
import styles from './HoursEditor.module.css';

interface Props {
  id?: string;
  value: string;
  onChange: (newValue: string) => void;
  required?: boolean;
}

export default function HoursEditor({ id, value, onChange, required }: Props) {
  const { t } = useTranslation();

  const parsed = useMemo(() => parseHours(value), [value]);
  const lastValueRef = useRef(value);
  const [week, setWeek] = useState<WeekHours>(parsed.week);
  const [touched, setTouched] = useState(parsed.success);

  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      const next = parseHours(value);
      setWeek(next.week);
      setTouched(next.success);
    }
  }, [value]);

  const showRawWarning = !parsed.success && !!value && !touched;

  function update(day: DayKey, patch: Partial<WeekHours[DayKey]>) {
    setWeek((prev) => {
      const next: WeekHours = { ...prev, [day]: { ...prev[day], ...patch } };
      const serialized = serializeHours(next);
      lastValueRef.current = serialized;
      onChange(serialized);
      return next;
    });
    setTouched(true);
  }

  return (
    <fieldset className={styles.editor} aria-describedby={showRawWarning ? `${id}-warning` : undefined}>
      <legend className={styles.srOnly}>{t('admin.hours.legend')}</legend>
      {showRawWarning && (
        <p id={`${id}-warning`} className={styles.warning} role="status">
          {t('admin.hours.parseWarning')} <strong>{value}</strong>
        </p>
      )}
      <table className={styles.table} role="presentation">
        <tbody>
          {DAY_KEYS.map((day) => {
            const d = week[day];
            const closedId = `${id}-${day}-closed`;
            const openId = `${id}-${day}-open`;
            const closeId = `${id}-${day}-close`;
            return (
              <tr key={day} className={styles.row}>
                <th scope="row" className={styles.dayLabel}>
                  {t(`admin.hours.day.${day.toLowerCase()}`)}
                </th>
                <td className={styles.timeCell}>
                  <label htmlFor={openId} className={styles.srOnly}>
                    {t('admin.hours.openTime', { day: t(`admin.hours.day.${day.toLowerCase()}`) })}
                  </label>
                  <input
                    id={openId}
                    type="time"
                    className={styles.timeInput}
                    value={d.open}
                    disabled={d.closed}
                    required={required && !d.closed}
                    onChange={(e) => update(day, { open: e.target.value })}
                  />
                  <span className={styles.dash} aria-hidden="true">–</span>
                  <label htmlFor={closeId} className={styles.srOnly}>
                    {t('admin.hours.closeTime', { day: t(`admin.hours.day.${day.toLowerCase()}`) })}
                  </label>
                  <input
                    id={closeId}
                    type="time"
                    className={styles.timeInput}
                    value={d.close}
                    disabled={d.closed}
                    required={required && !d.closed}
                    onChange={(e) => update(day, { close: e.target.value })}
                  />
                </td>
                <td className={styles.closedCell}>
                  <label htmlFor={closedId} className={styles.closedLabel}>
                    <input
                      id={closedId}
                      type="checkbox"
                      checked={d.closed}
                      onChange={(e) => update(day, { closed: e.target.checked })}
                    />
                    {t('admin.hours.closed')}
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </fieldset>
  );
}
