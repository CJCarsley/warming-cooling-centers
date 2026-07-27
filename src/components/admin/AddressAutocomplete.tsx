import { useEffect, useId, useRef, useState } from 'react';
import { suggestAddresses, type AddressSuggestion } from '../../utils/geocode';
import styles from './AddressAutocomplete.module.css';

interface Props {
  id: string;
  value: string;
  required?: boolean;
  inputClassName?: string;
  listboxLabel: string;
  onChange: (value: string) => void;
  onPick: (suggestion: AddressSuggestion) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}

const MIN_CHARS = 4;
const DEBOUNCE_MS = 300;

export default function AddressAutocomplete({
  id,
  value,
  required,
  inputClassName,
  listboxLabel,
  onChange,
  onPick,
  inputRef,
}: Props) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0); // guards against out-of-order responses
  const skipNextRef = useRef(false); // suppress the fetch caused by selecting a suggestion
  const listId = useId();

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    const query = value.trim();
    if (query.length < MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const seq = ++seqRef.current;
      void suggestAddresses(query)
        .then((results) => {
          if (seq !== seqRef.current) return; // a newer query superseded this one
          setSuggestions(results);
          setActiveIndex(-1);
          setOpen(results.length > 0);
        })
        .catch(() => {
          if (seq === seqRef.current) { setSuggestions([]); setOpen(false); }
        });
    }, DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = (s: AddressSuggestion) => {
    skipNextRef.current = true;
    onChange(s.text);
    onPick(s);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) { setOpen(true); e.preventDefault(); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        break;
      case 'Enter':
        if (activeIndex >= 0) { e.preventDefault(); select(suggestions[activeIndex]); }
        break;
      case 'Escape':
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const activeId = activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined;

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <input
        id={id}
        type="text"
        className={inputClassName}
        value={value}
        required={required}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        ref={inputRef}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={listboxLabel} className={styles.listbox}>
          {suggestions.map((s, i) => (
            <li
              key={s.magicKey}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`${styles.option} ${i === activeIndex ? styles.optionActive : ''}`}
              // onMouseDown (not onClick) so it fires before the input blur closes the list
              onMouseDown={(e) => { e.preventDefault(); select(s); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {s.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
