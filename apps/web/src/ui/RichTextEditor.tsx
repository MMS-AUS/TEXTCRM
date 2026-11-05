import TextAlign from '@tiptap/extension-text-align';
import {
  BackgroundColor,
  Color,
  FontFamily,
  FontSize,
  TextStyle,
} from '@tiptap/extension-text-style';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  EMAIL_FONT_SIZES,
  EMAIL_FONTS,
  EMAIL_HIGHLIGHT_COLORS,
  EMAIL_TEXT_COLORS,
} from '@mms/shared';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Check,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
  X,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { IconButton } from './Button.tsx';
import { cn } from './cn.ts';
import { Label } from './Field.tsx';
import { Input } from './Input.tsx';
import { normaliseLink } from './links.ts';
import { Popover, PopoverContent, PopoverTrigger } from './Popover.tsx';
import { Select } from './Select.tsx';

// The email composer's editor (Step 5.2): fonts, sizes, colours, highlight, alignment, lists,
// quotes, lines and links — the same set the server keeps when it cleans the HTML
// (email-html.ts), so what you see is what's sent. The writing area is white like the email
// the customer will read, in light and dark mode alike.

const DEFAULT_FONT = EMAIL_FONTS[0].value;
const DEFAULT_SIZE = '14px';

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <IconButton
      size="sm"
      label={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(active && 'bg-surface-2 text-fg')}
      // Keep the editor's selection when the button is pressed.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />;

/** A swatch grid in a popover: text colour or highlight. */
function ColorMenu({
  label,
  icon,
  colors,
  current,
  resetLabel,
  onPick,
}: {
  label: string;
  icon: ReactNode;
  colors: readonly string[];
  current: string | null;
  resetLabel: string;
  onPick: (color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (color: string | null) => {
    onPick(color);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          size="sm"
          label={label}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        >
          <span className="relative flex flex-col items-center">
            {icon}
            <span
              aria-hidden
              className="absolute -bottom-1 h-0.5 w-4 rounded-full"
              style={{ background: current ?? 'currentColor' }}
            />
          </span>
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" aria-label={label}>
        <div className="grid grid-cols-6 gap-1">
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`${label} ${color}`}
              aria-pressed={current?.toLowerCase() === color}
              className={cn(
                'size-6 rounded border border-line-strong focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none',
                current?.toLowerCase() === color && 'ring-2 ring-accent',
              )}
              style={{ background: color }}
              onClick={() => {
                pick(color);
              }}
            />
          ))}
        </div>
        <button
          type="button"
          className="mt-2 w-full rounded px-2 py-1 text-left text-xs text-fg-muted hover:bg-surface-2"
          onClick={() => {
            pick(null);
          }}
        >
          {resetLabel}
        </button>
      </PopoverContent>
    </Popover>
  );
}

const ALIGNMENTS = [
  { value: 'left', label: 'Align left', icon: <AlignLeft /> },
  { value: 'center', label: 'Align centre', icon: <AlignCenter /> },
  { value: 'right', label: 'Align right', icon: <AlignRight /> },
  { value: 'justify', label: 'Justify', icon: <AlignJustify /> },
] as const;

function AlignMenu({ editor, current }: { editor: Editor; current: string }) {
  const [open, setOpen] = useState(false);
  const shown = ALIGNMENTS.find((a) => a.value === current) ?? ALIGNMENTS[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          size="sm"
          label="Alignment"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        >
          {shown.icon}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto gap-0.5 p-1 [&_svg]:size-4">
        {ALIGNMENTS.map((a) => (
          <ToolButton
            key={a.value}
            label={a.label}
            active={current === a.value}
            onClick={() => {
              if (a.value === 'left') editor.chain().focus().unsetTextAlign().run();
              else editor.chain().focus().setTextAlign(a.value).run();
              setOpen(false);
            }}
          >
            {a.icon}
          </ToolButton>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LinkBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [href, setHref] = useState(() => {
    const current: unknown = editor.getAttributes('link').href;
    return typeof current === 'string' ? current : '';
  });
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const url = normaliseLink(href);
    if (!url) {
      setError('Enter a web address (or an email address).');
      return;
    }
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // Nothing selected: insert the address itself as the link text.
      chain
        .insertContent({
          type: 'text',
          text: href.trim(),
          marks: [{ type: 'link', attrs: { href: url } }],
        })
        .run();
    } else {
      chain.extendMarkRange('link').setLink({ href: url }).run();
    }
    onClose();
  };
  return (
    <div className="flex flex-col gap-1 border-b border-line bg-surface-2/60 px-2 py-1.5">
      <div className="flex items-center gap-1">
        <Input
          aria-label="Link address"
          placeholder="https://… or name@example.com"
          className="h-7"
          autoFocus
          value={href}
          onChange={(event) => {
            setHref(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
        />
        <IconButton size="sm" label="Apply link" onClick={apply}>
          <Check />
        </IconButton>
        <IconButton size="sm" label="Cancel link" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      {error && <p className="text-xs text-danger-text">{error}</p>}
    </div>
  );
}

export type RichTextEditorProps = {
  label: string;
  required?: boolean;
  /** Starting content (HTML); later changes to it are ignored. */
  defaultValue?: string;
  /** The HTML and its plain text (to tell whether anything was written). */
  onChange: (html: string, text: string) => void;
  /** Shown inside the writing area, under the text (e.g. the signature preview). */
  footer?: ReactNode;
  className?: string;
};

const textStyleValue = (editor: Editor, name: string): string | null => {
  const value: unknown = editor.getAttributes('textStyle')[name];
  return typeof value === 'string' && value ? value : null;
};

export function RichTextEditor({
  label,
  required,
  defaultValue = '',
  onChange,
  footer,
  className,
}: RichTextEditorProps) {
  const labelId = useId();
  const [linking, setLinking] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Only what the server keeps (see email-html.ts).
        heading: false,
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      BackgroundColor,
      TextAlign.configure({
        types: ['paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
      }),
    ],
    content: defaultValue,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelId,
        ...(required ? { 'aria-required': 'true' } : {}),
        class: 'rich-text email-text min-h-48 px-3 py-2 outline-none',
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          setLinking(true);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      // The empty paragraph kept after a list (so you can type below it) isn't content.
      const html = current.isEmpty ? '' : current.getHTML().replace(/(<p><\/p>)+$/, '');
      onChange(html, current.getText());
    },
  });
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
      font: textStyleValue(e, 'fontFamily') ?? DEFAULT_FONT,
      size: textStyleValue(e, 'fontSize') ?? DEFAULT_SIZE,
      color: textStyleValue(e, 'color'),
      highlight: textStyleValue(e, 'backgroundColor'),
      align:
        (['center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ??
        'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const sizeKnown = EMAIL_FONT_SIZES.some((s) => s.value === active.size);
  const fontKnown = EMAIL_FONTS.some((f) => f.value === active.font);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label id={labelId} onClick={() => editor.commands.focus()}>
        {label}
        {required && (
          <span className="ml-0.5 text-danger-text" aria-hidden>
            *
          </span>
        )}
      </Label>
      <div className="overflow-hidden rounded-md border border-line-strong bg-surface shadow-xs focus-within:border-accent focus-within:ring-3 focus-within:ring-ring">
        <div
          role="toolbar"
          aria-label="Formatting"
          className="flex flex-wrap items-center gap-0.5 border-b border-line px-1 py-1 [&_svg]:size-4"
        >
          <ToolButton
            label="Undo"
            disabled={!active.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 />
          </ToolButton>
          <ToolButton
            label="Redo"
            disabled={!active.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 />
          </ToolButton>
          <Divider />
          <Select
            aria-label="Font"
            className="h-7 w-32 text-xs"
            value={fontKnown ? active.font : DEFAULT_FONT}
            options={EMAIL_FONTS.map((f) => ({ value: f.value, label: f.label }))}
            onValueChange={(value) => {
              if (value === DEFAULT_FONT) editor.chain().focus().unsetFontFamily().run();
              else editor.chain().focus().setFontFamily(value).run();
            }}
          />
          <Select
            aria-label="Size"
            className="h-7 w-24 text-xs"
            value={sizeKnown ? active.size : DEFAULT_SIZE}
            options={EMAIL_FONT_SIZES.map((s) => ({ value: s.value, label: s.label }))}
            onValueChange={(value) => {
              if (value === DEFAULT_SIZE) editor.chain().focus().unsetFontSize().run();
              else editor.chain().focus().setFontSize(value).run();
            }}
          />
          <Divider />
          <ToolButton
            label="Bold"
            active={active.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold />
          </ToolButton>
          <ToolButton
            label="Italic"
            active={active.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic />
          </ToolButton>
          <ToolButton
            label="Underline"
            active={active.underline}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <Underline />
          </ToolButton>
          <ToolButton
            label="Strikethrough"
            active={active.strike}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough />
          </ToolButton>
          <ColorMenu
            label="Text colour"
            icon={<Baseline />}
            colors={EMAIL_TEXT_COLORS}
            current={active.color}
            resetLabel="Default colour"
            onPick={(color) => {
              if (color) editor.chain().focus().setColor(color).run();
              else editor.chain().focus().unsetColor().run();
            }}
          />
          <ColorMenu
            label="Highlight"
            icon={<Highlighter />}
            colors={EMAIL_HIGHLIGHT_COLORS}
            current={active.highlight}
            resetLabel="No highlight"
            onPick={(color) => {
              if (color) editor.chain().focus().setBackgroundColor(color).run();
              else editor.chain().focus().unsetBackgroundColor().run();
            }}
          />
          <Divider />
          <AlignMenu editor={editor} current={active.align} />
          <ToolButton
            label="Bulleted list"
            active={active.bullet}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List />
          </ToolButton>
          <ToolButton
            label="Numbered list"
            active={active.ordered}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered />
          </ToolButton>
          <ToolButton
            label="Quote"
            active={active.quote}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote />
          </ToolButton>
          <ToolButton
            label="Horizontal line"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus />
          </ToolButton>
          <Divider />
          <ToolButton
            label="Link"
            active={active.link || linking}
            onClick={() => {
              setLinking(true);
            }}
          >
            <LinkIcon />
          </ToolButton>
          {active.link && (
            <ToolButton
              label="Remove link"
              onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
            >
              <Unlink />
            </ToolButton>
          )}
          <ToolButton
            label="Clear formatting"
            onClick={() => editor.chain().focus().unsetAllMarks().unsetTextAlign().run()}
          >
            <RemoveFormatting />
          </ToolButton>
        </div>
        {linking && (
          <LinkBar
            editor={editor}
            onClose={() => {
              setLinking(false);
              editor.commands.focus();
            }}
          />
        )}
        <div className="email-paper max-h-[50vh] overflow-y-auto">
          <EditorContent editor={editor} />
          {footer && <div className="px-3 pb-3">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
