// Formatting utilities: convert lightweight markdown-like syntax into Telegram HTML
// Supports: **bold**, __italic__, `inline code`, ```code blocks```, blockquotes starting with >

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatToHtml(raw: string): string {
  if (!raw) return '';
  // Extract fenced code blocks
  const codeBlocks: string[] = [];
  let text = raw.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`);
    return `[[CODEBLOCK_${idx}]]`;
  });

  // Escape remaining (after code extraction)
  text = escapeHtml(text);

  // Blockquotes: group consecutive > lines (already escaped so > is &gt;)
  const lines = text.split(/\n/);
  let out: string[] = [];
  let quoteBuffer: string[] = [];
  const flushQuote = () => {
    if (quoteBuffer.length) {
      out.push(`<blockquote>${quoteBuffer.join('\n')}</blockquote>`);
      quoteBuffer = [];
    }
  };
  for (const ln of lines) {
    if (/^&gt;\s?/.test(ln)) {
      quoteBuffer.push(ln.replace(/^&gt;\s?/, ''));
    } else {
      flushQuote();
      out.push(ln);
    }
  }
  flushQuote();
  text = out.join('\n');

  // Inline code
  text = text.replace(/`([^`]+?)`/g, (_m, c) => `<code>${c}</code>`);
  // Bold & Italic
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<i>$1</i>');

  // Restore code blocks
  text = text.replace(/\[\[CODEBLOCK_(\d+)]]/g, (_m, i) => codeBlocks[Number(i)] || '');
  return text;
}
