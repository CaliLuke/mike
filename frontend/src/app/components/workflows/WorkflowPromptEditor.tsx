"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading1, Heading2, Heading3, Italic, List, ListOrdered } from "lucide-react";
import { useEffect, useRef } from "react";
import { Markdown } from "tiptap-markdown";

interface Props {
  value: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
}

type MarkdownStorage = {
  markdown: {
    getMarkdown: () => string;
  };
};

function ToolbarBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor focus
        onClick();
      }}
      className={`rounded p-1.5 transition-colors ${
        active ? "bg-gray-200 text-gray-900" : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      }`}
    >
      {children}
    </button>
  );
}

export function WorkflowPromptEditor({ value, onChange, readOnly = false }: Props) {
  const lastEmittedRef = useRef(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      // tiptap-markdown adds .markdown to storage but isn't typed on Editor.storage

      const md = (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown();
      lastEmittedRef.current = md;
      onChange?.(md);
    },
    editorProps: {
      attributes: {
        class: "workflow-editor-content",
      },
    },
  });

  // Sync external value (e.g. on load from API)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-gray-200 bg-white">
      {!readOnly && editor && (
        <div className="flex shrink-0 items-center gap-0.5 border-b border-gray-100 bg-gray-50 px-2 py-1.5">
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive("heading", { level: 1 })}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive("heading", { level: 2 })}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive("heading", { level: 3 })}
            title="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarBtn>
          <div className="mx-1 h-4 w-px shrink-0 bg-gray-200" />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </ToolbarBtn>
          <div className="mx-1 h-4 w-px shrink-0 bg-gray-200" />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title="Bullet list"
          >
            <List className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title="Numbered list"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarBtn>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
