/** Props for a text input bound to a form field whose value may be null or undefined. */
export function textInput(field: {
  name: string;
  value: unknown;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return {
    name: field.name,
    value: typeof field.value === 'string' ? field.value : '',
    onChange: (event: { target: { value: string } }) => {
      field.onChange(event.target.value);
    },
    onBlur: field.onBlur,
  };
}
