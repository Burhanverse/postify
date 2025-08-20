// Formatting utilities: convert user-typed HTML-like tags into proper Telegram HTML
// Supports: <b>bold</b>, <i>italic</i>, <code>inline code</code>, <pre>code blocks</pre>, <blockquote>quotes</blockquote>

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatToHtml(raw: string): string {
  if (!raw) return "";

  // First, extract properly formatted tags to preserve them
  const preservedTags: string[] = [];
  let text = raw;

  // Extract and preserve <pre> blocks first (to avoid processing content inside)
  text = text.replace(/<pre>([\s\S]*?)<\/pre>/gi, (_m, content) => {
    const idx = preservedTags.length;
    preservedTags.push(`<pre><code>${escapeHtml(content)}</code></pre>`);
    return `[[PRESERVED_${idx}]]`;
  });

  // Extract and preserve <blockquote> blocks
  text = text.replace(
    /<blockquote>([\s\S]*?)<\/blockquote>/gi,
    (_m, content) => {
      const idx = preservedTags.length;
      preservedTags.push(`<blockquote>${escapeHtml(content)}</blockquote>`);
      return `[[PRESERVED_${idx}]]`;
    },
  );

  // Extract and preserve <code> blocks (inline code)
  text = text.replace(/<code>(.*?)<\/code>/gi, (_m, content) => {
    const idx = preservedTags.length;
    preservedTags.push(`<code>${escapeHtml(content)}</code>`);
    return `[[PRESERVED_${idx}]]`;
  });

  // Now escape the remaining text
  text = escapeHtml(text);

  // Process bold and italic tags on the escaped text
  text = text.replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/gi, "<b>$1</b>");
  text = text.replace(/&lt;i&gt;(.*?)&lt;\/i&gt;/gi, "<i>$1</i>");

  // Restore preserved tags
  text = text.replace(
    /\[\[PRESERVED_(\d+)]]/g,
    (_m, i) => preservedTags[Number(i)] || "",
  );

  return text;
}
