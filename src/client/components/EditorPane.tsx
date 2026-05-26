import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, keymap } from '@codemirror/view';
import { useMemo } from 'react';
import { PaneHeader } from './PaneHeader.jsx';

function markdownExtension() {
  return markdown({ base: markdownLanguage, codeLanguages: languages });
}

export function EditorPane({
  fileName,
  markdown: markdownText,
  onChange,
  onCreateEditor,
  onSave,
}: {
  fileName: string;
  markdown: string;
  onChange: (value: string) => void;
  onCreateEditor: (view: EditorView) => void;
  onSave: () => void;
}) {
  const extensions = useMemo(
    () => [
      markdownExtension(),
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            onSave();
            return true;
          },
        },
      ]),
    ],
    [onSave],
  );

  return (
    <section
      id="editor"
      className="flex h-full min-w-0 flex-col border-r border-[#2b2f38] bg-[#17181c]"
      data-testid="editor"
    >
      <PaneHeader title="Editor" detail={fileName} />
      <div className="min-h-0 flex-1 overflow-auto" data-testid="editor-frame">
        <CodeMirror
          basicSetup
          extensions={extensions}
          height="100%"
          theme="dark"
          value={markdownText}
          onChange={onChange}
          onCreateEditor={onCreateEditor}
        />
      </div>
    </section>
  );
}
