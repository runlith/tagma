import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core';

const LANGUAGES: readonly { value: string; label: string }[] = [
  { value: '', label: 'Plain text' },
  { value: 'bash', label: 'Bash' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'css', label: 'CSS' },
  { value: 'diff', label: 'Diff' },
  { value: 'go', label: 'Go' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'html', label: 'HTML' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'python', label: 'Python' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'scss', label: 'SCSS' },
  { value: 'shell', label: 'Shell' },
  { value: 'sql', label: 'SQL' },
  { value: 'swift', label: 'Swift' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
];

const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const COPIED_RESET_MS = 1_500;

export const codeBlockView: NodeViewRenderer = ({ editor, node, getPos }: NodeViewRendererProps) => {
  let current = node;

  const dom = document.createElement('div');
  dom.className = 'markdown-code-block';

  const select = document.createElement('select');
  select.className = 'markdown-code-block-lang';
  select.contentEditable = 'false';
  const renderOptions = (language: string): void => {
    select.innerHTML = '';
    for (const item of LANGUAGES) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    }
    if (language && !LANGUAGES.some((item) => item.value === language)) {
      const option = document.createElement('option');
      option.value = language;
      option.textContent = language;
      select.appendChild(option);
    }
    select.value = language;
  };
  renderOptions((current.attrs.language as string | null) ?? '');
  select.addEventListener('change', () => {
    const pos = getPos();
    if (pos === undefined) return;
    const { state, dispatch } = editor.view;
    dispatch(state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, language: select.value || null }));
  });

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'markdown-code-block-copy';
  copy.contentEditable = 'false';
  copy.setAttribute('aria-label', 'Copy code');
  copy.title = 'Copy code';
  copy.innerHTML = COPY_ICON;
  let resetTimer: number | null = null;
  copy.addEventListener('click', (event) => {
    event.stopPropagation();
    void navigator.clipboard
      .writeText(current.textContent)
      .then(() => {
        copy.innerHTML = `${CHECK_ICON}<span class="markdown-code-block-copied">Copied</span>`;
        if (resetTimer !== null) window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => {
          resetTimer = null;
          copy.innerHTML = COPY_ICON;
        }, COPIED_RESET_MS);
      })
      .catch(() => {});
  });

  const pre = document.createElement('pre');

  const chrome = document.createElement('div');
  chrome.className = 'markdown-code-block-chrome';
  chrome.contentEditable = 'false';
  chrome.appendChild(copy);
  chrome.appendChild(select);

  dom.appendChild(chrome);
  dom.appendChild(pre);

  return {
    dom,
    contentDOM: pre,
    update: (updatedNode) => {
      if (updatedNode.type.name !== current.type.name) return false;
      const previous = (current.attrs.language as string | null) ?? '';
      current = updatedNode;
      const language = (updatedNode.attrs.language as string | null) ?? '';
      if (language !== previous) renderOptions(language);
      return true;
    },
    ignoreMutation: (mutation) => !pre.contains(mutation.target),
    stopEvent: (event) => {
      const target = event.target;
      return target instanceof Node && chrome.contains(target);
    },
    destroy: () => {
      if (resetTimer !== null) window.clearTimeout(resetTimer);
    },
  };
};
