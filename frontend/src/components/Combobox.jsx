import { useEffect, useRef, useState } from 'react';

// A genuinely reusable live-filtering combobox — one text input, a dropdown that narrows on
// every keystroke, no separate "search box next to a picker" (that pattern is what Receive
// Stock had before this component existed; see LEARNING_LOG.md). Deliberately its own
// component, not a patch on CreatableSelect: CreatableSelect is a native <select> (still the
// right tool for Factory/Location, which don't have a growing-list problem), and bolting
// live-filter/keyboard-nav behaviour onto a native <select> isn't possible — a <select>'s own
// option list can't be redrawn per keystroke the way this needs.
//
// Prop shape deliberately mirrors CreatableSelect's own (fieldLabel/value/onChange/options/
// disabled/placeholder/canCreate/onCreate) — not because they share an implementation, but so
// a screen that only ever single-selects from a list (Receive Stock's color picker) can adopt
// this with the same value shape it already tracks, per the task's own "don't change what gets
// stored, only how it's picked."
export default function Combobox({
  fieldLabel,
  value,
  onChange,
  options,
  disabled,
  placeholder,
  canCreate,
  onCreate,
}) {
  const [inputText, setInputText] = useState(() => options.find((o) => o.id === value)?.name ?? '');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Keeps the input's displayed text honest against the real controlled `value` whenever it
  // changes from OUTSIDE this component (a screen-level reset, a freshly-created option
  // auto-selected by the caller) — but never while the dropdown is open, or this would stomp on
  // in-progress typing. This is the direct equivalent, in a text-input, of the fix Receive
  // Stock's native-<select> search needed: there, a filtered `options` list could make a
  // *controlled* <select> silently show blank because its current value wasn't among the
  // rendered <option>s. A text input can't fail that way (its displayed text is its own state,
  // not derived from which rows are currently rendered) — but it can drift out of sync with
  // `value` if nothing re-syncs it, which is the same underlying failure mode by a different
  // mechanism. This effect is that guarantee, kept every time `value`/`options` change.
  useEffect(() => {
    if (open) return;
    const selected = options.find((o) => o.id === value);
    setInputText(selected ? selected.name : '');
  }, [value, options, open]);

  const trimmed = inputText.trim();
  const filteredOptions = trimmed
    ? options.filter((o) => o.name.toLowerCase().includes(trimmed.toLowerCase()))
    : options;
  // Only once something's actually been typed — there's nothing to name a new option with
  // otherwise. Shown as the LAST row whenever there's a query, matching options or not (not
  // gated on zero matches specifically), so it's always reachable the same way Receive Stock's
  // "+ Create new color" already had to be, not just when a search happens to strike out.
  const createRowVisible = !!canCreate && trimmed !== '';
  const rows = [
    ...filteredOptions.map((option) => ({ type: 'option', option })),
    ...(createRowVisible ? [{ type: 'create' }] : []),
  ];

  function closeAndRevert() {
    setOpen(false);
    setCreateError(null);
    const selected = options.find((o) => o.id === value);
    setInputText(selected ? selected.name : '');
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        closeAndRevert();
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value, options]);

  function selectOption(option) {
    onChange(option.id);
    setInputText(option.name);
    setOpen(false);
    setCreateError(null);
  }

  async function triggerCreate() {
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await onCreate(trimmed);
      onChange(created.id);
      setInputText(created.name);
      setOpen(false);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function handleInputChange(e) {
    setInputText(e.target.value);
    setOpen(true);
    setHighlightedIndex(0);
    setCreateError(null);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlightedIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const row = rows[highlightedIndex];
      if (!row) return;
      if (row.type === 'option') selectOption(row.option);
      else triggerCreate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeAndRevert();
      inputRef.current?.blur();
    }
  }

  return (
    <div className="field combobox" ref={containerRef}>
      <span className="field-label">{fieldLabel}</span>
      <input
        ref={inputRef}
        type="text"
        className="combobox-input"
        value={inputText}
        onChange={handleInputChange}
        onFocus={() => {
          setOpen(true);
          setHighlightedIndex(0);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={fieldLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
      />

      {open && !disabled && (
        <ul className="combobox-dropdown" role="listbox">
          {rows.length === 0 && <li className="combobox-empty-row">{placeholder}</li>}
          {filteredOptions.map((option, index) => (
            <li
              key={option.id}
              role="option"
              aria-selected={option.id === value}
              className={`combobox-option${index === highlightedIndex ? ' combobox-option-highlighted' : ''}${option.id === value ? ' combobox-option-selected' : ''}`}
              // onMouseDown (not onClick) + preventDefault so the input never blurs before the
              // pick registers — a blur would fire closeAndRevert first and discard the click.
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(option);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {option.name}
            </li>
          ))}
          {createRowVisible && (
            <li
              role="option"
              className={`combobox-option combobox-create-row${filteredOptions.length === highlightedIndex ? ' combobox-option-highlighted' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                triggerCreate();
              }}
              onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
            >
              {creating ? 'Creating…' : `+ Create new ${fieldLabel.toLowerCase()} "${trimmed}"`}
            </li>
          )}
        </ul>
      )}

      {createError && (
        <p className="error-banner" role="alert">
          {createError}
        </p>
      )}
    </div>
  );
}
