// Formatting utilities: convert user-typed HTML-like tags into proper Telegram HTML
// Supports: <b>bold</b>, <i>italic</i>, <code>inline code</code>, <pre>code blocks</pre>, <blockquote>quotes</blockquote>

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatToHtml(raw: string): string {
  if (!raw) return "";

  // First, extract and preserve special blocks that shouldn't be processed for nested tags
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

  // Process nested bold and italic tags properly
  text = parseNestedFormattingTags(text);

  // Restore preserved tags
  text = text.replace(
    /\[\[PRESERVED_(\d+)]]/g,
    (_m, i) => preservedTags[Number(i)] || "",
  );

  return text;
}

function parseNestedFormattingTags(text: string): string {
  // Parse and convert user-typed formatting tags to proper HTML
  // This handles nested tags properly by using a stack-based approach
  
  const tagRegex = /<\/?([bi])>/gi;
  const tokens: Array<{ type: 'text' | 'open' | 'close', tag?: string, content: string, pos: number }> = [];
  
  let lastIndex = 0;
  let match;
  
  // Tokenize the input
  while ((match = tagRegex.exec(text)) !== null) {
    // Add text before this tag
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
        pos: lastIndex
      });
    }
    
    // Add the tag
    const isClosing = match[0].startsWith('</');
    tokens.push({
      type: isClosing ? 'close' : 'open',
      tag: match[1].toLowerCase(),
      content: match[0],
      pos: match.index
    });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      content: text.slice(lastIndex),
      pos: lastIndex
    });
  }
  
  // Process tokens with a stack to handle nesting
  const stack: string[] = [];
  let result = '';
  
  for (const token of tokens) {
    if (token.type === 'text') {
      // Escape HTML in text content
      result += escapeHtml(token.content);
    } else if (token.type === 'open') {
      // Opening tag
      stack.push(token.tag!);
      result += `<${token.tag}>`;
    } else if (token.type === 'close') {
      // Closing tag - find matching opening tag in stack
      const tagIndex = stack.lastIndexOf(token.tag!);
      if (tagIndex !== -1) {
        // Close all tags from the top of stack down to the matching tag
        const tagsToClose = stack.splice(tagIndex);
        tagsToClose.reverse().forEach(tag => {
          result += `</${tag}>`;
        });
      }
      // If no matching opening tag found, ignore the closing tag
    }
  }
  
  // Close any remaining open tags
  while (stack.length > 0) {
    const tag = stack.pop();
    result += `</${tag}>`;
  }
  
  return result;
}
