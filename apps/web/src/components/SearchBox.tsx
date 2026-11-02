import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDebouncedValue } from '../lib/hooks.ts';
import { Input } from '../ui/index.ts';

/** A list's search field: reports the text once typing pauses (300 ms). */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text);

  useEffect(() => {
    if (debounced.trim() !== value) onChange(debounced.trim());
    // Only react to the user's typing; `value` changing because of it must not re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="w-full sm:w-72">
      <Input
        type="search"
        leading={<Search />}
        placeholder={placeholder}
        aria-label={label}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
    </div>
  );
}
