import { useState } from 'react';
import { RichTextEditor, Link } from '@mantine/tiptap';
import { useEditor, EditorOptions, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Paper } from '@mantine/core';

// Re-add the regex check here
const HTML_TAG_REGEX = /<[a-z][\s\S]*>/i;

// Default extensions can be defined outside
const defaultExtensions = [
  StarterKit.configure({
    heading: { levels: [3] },
    bold: {},
    italic: {},
    strike: false,
    code: false,
    codeBlock: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    horizontalRule: false,
  }),
  Link.configure({ openOnClick: false }),
];

interface ConfiguredRichTextEditorProps {
  name?: string; // Make name optional - controls hidden input rendering
  initialContent?: string;
  mt?: string | number;
  // Optional prop to override Tiptap extensions
  extensions?: EditorOptions['extensions'];
  // Props to control default toolbar visibility
  withHeadingControl?: boolean;
  withFormattingControls?: boolean;
  withLinkControls?: boolean;
}

export function ConfiguredRichTextEditor({
  name,
  initialContent = '',
  mt,
  extensions,
  withHeadingControl = true,
  withFormattingControls = true,
  withLinkControls = true,
}: ConfiguredRichTextEditorProps) {
  const [htmlContent, setHtmlContent] = useState(initialContent);

  // --- Preprocessing Logic --- 
  let processedInitialContent = initialContent;
  if (initialContent && !HTML_TAG_REGEX.test(initialContent)) {
    // Content is likely plain text, convert line breaks to paragraphs
    processedInitialContent = initialContent
      .split('\n') // Split into lines
      .map(line => line.trim()) // Trim whitespace
      .filter(line => line.length > 0) // Remove empty lines
      .map(line => `<p>${line}</p>`) // Wrap each line in <p> tags
      .join(''); // Join back together
  }
  // --- End Preprocessing Logic ---

  const editor = useEditor({
    // Use provided extensions or the default set
    extensions: extensions ?? defaultExtensions,
    // Use the potentially preprocessed content for initialization
    content: processedInitialContent,
    onUpdate: ({ editor }) => {
      setHtmlContent(editor.getHTML()); // Update local state on editor changes
    },
  });

  return (
    <>
      {/* Render hidden input only if name is provided */}
      {name && <input type="hidden" name={name} value={htmlContent} />}

      <RichTextEditor
        editor={editor}
        mt={mt}
        // Add styles to control font sizes
        styles={{
          content: {
            fontSize: 'var(--mantine-font-size-sm)', // Reduce base font size
            cursor: 'text', // Add text cursor style
            'h3': {
              fontSize: 'var(--mantine-font-size-lg)', // Reduce H3 font size
              marginTop: 'var(--mantine-spacing-sm)', // Adjust spacing if needed
              marginBottom: 'var(--mantine-spacing-xs)',
            },
            // Ensure paragraphs have appropriate spacing too
            'p': {
              fontSize: 'var(--mantine-font-size-sm)',
              marginBottom: 'var(--mantine-spacing-xs)',
            }
          },
        }}
      >
        <RichTextEditor.Toolbar sticky stickyOffset={60}>
          {/* Conditionally render control groups */}
          {withHeadingControl && (
            <RichTextEditor.ControlsGroup>
              <RichTextEditor.H3 />
            </RichTextEditor.ControlsGroup>
          )}

          {withFormattingControls && (
            <RichTextEditor.ControlsGroup>
              <RichTextEditor.Bold />
              <RichTextEditor.Italic />
            </RichTextEditor.ControlsGroup>
          )}

          {withLinkControls && (
            <RichTextEditor.ControlsGroup>
              <RichTextEditor.Link />
              <RichTextEditor.Unlink />
            </RichTextEditor.ControlsGroup>
          )}
        </RichTextEditor.Toolbar>

        <RichTextEditor.Content />
      </RichTextEditor>
    </>
  );
} 