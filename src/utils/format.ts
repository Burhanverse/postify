// Formatting utilities: convert user-typed HTML-like tags into proper Telegram HTML
// Supports: <b>bold</b>, <i>italic</i>, <code>inline code</code>, <pre>code blocks</pre>, <blockquote>quotes</blockquote>

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatToHtml(raw: string): string {
  if (!raw) return "";

  const preservedTags: string[] = [];
  let text = raw;

  text = text.replace(/<pre>([\s\S]*?)<\/pre>/gi, (_m, content) => {
    const idx = preservedTags.length;
    preservedTags.push(`<pre><code>${escapeHtml(content)}</code></pre>`);
    return `[[PRESERVED_${idx}]]`;
  });

  text = text.replace(/<code>(.*?)<\/code>/gi, (_m, content) => {
    const idx = preservedTags.length;
    preservedTags.push(`<code>${escapeHtml(content)}</code>`);
    return `[[PRESERVED_${idx}]]`;
  });

  text = parseAllHtmlTags(text);

  text = text.replace(
    /\[\[PRESERVED_(\d+)]]/g,
    (_m, i) => preservedTags[Number(i)] || "",
  );

  return text;
}

function parseAllHtmlTags(text: string): string {
  // Parse and convert user-typed HTML tags to proper HTML
  // This handles any HTML tag with proper nesting using a stack-based approach

  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/gi;
  const tokens: Array<{ 
    type: 'text' | 'open' | 'close' | 'selfclosing',
    tag?: string,
    content: string,
    pos: number,
    attributes?: string
  }> = [];
  
  let lastIndex = 0;
  let match;
  
  while ((match = tagRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
        pos: lastIndex
      });
    }
    
    const fullMatch = match[0];
    const tagName = match[1].toLowerCase();
    
    if (fullMatch.startsWith('</')) {
      tokens.push({
        type: 'close',
        tag: tagName,
        content: fullMatch,
        pos: match.index
      });
    } else if (fullMatch.endsWith('/>') || ['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tagName)) {
      const attributes = extractAttributes(fullMatch);
      tokens.push({
        type: 'selfclosing',
        tag: tagName,
        content: fullMatch,
        pos: match.index,
        attributes
      });
    } else {
      const attributes = extractAttributes(fullMatch);
      tokens.push({
        type: 'open',
        tag: tagName,
        content: fullMatch,
        pos: match.index,
        attributes
      });
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      content: text.slice(lastIndex),
      pos: lastIndex
    });
  }
  
  const stack: Array<{tag: string, attributes?: string}> = [];
  let result = '';
  
  for (const token of tokens) {
    if (token.type === 'text') {
      result += escapeHtml(token.content);
    } else if (token.type === 'selfclosing') {
      if (token.attributes) {
        result += `<${token.tag}${token.attributes}>`;
      } else {
        result += `<${token.tag}>`;
      }
    } else if (token.type === 'open') {
      stack.push({tag: token.tag!, attributes: token.attributes});
      if (token.attributes) {
        result += `<${token.tag}${token.attributes}>`;
      } else {
        result += `<${token.tag}>`;
      }
    } else if (token.type === 'close') {
      let tagIndex = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === token.tag) {
          tagIndex = i;
          break;
        }
      }
      if (tagIndex !== -1) {
        const tagsToClose = stack.splice(tagIndex);
        tagsToClose.reverse().forEach(stackItem => {
          result += `</${stackItem.tag}>`;
        });
      }
    }
  }
  
  while (stack.length > 0) {
    const stackItem = stack.pop();
    if (stackItem) {
      result += `</${stackItem.tag}>`;
    }
  }
  
  return result;
}

function extractAttributes(tagString: string): string {
  // Extract attributes from a tag string like '<a href="..." class="...">'
  // Returns the attributes part with leading space, or empty string if none
  
  const match = tagString.match(/<[a-zA-Z][a-zA-Z0-9]*\b([^>]*?)>/);
  if (!match || !match[1]) return '';
  
  const attributePart = match[1].trim();
  if (!attributePart) return '';
  
  const attrRegex = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*["']([^"']*)["']/g;
  const sanitizedAttrs: string[] = [];
  let attrMatch;
  
  while ((attrMatch = attrRegex.exec(attributePart)) !== null) {
    const attrName = attrMatch[1].toLowerCase();
    const attrValue = attrMatch[2];

    let sanitizedValue: string;
    if (attrName === 'href' || attrName === 'src') {
      sanitizedValue = attrValue.replace(/[<>"']/g, (char) => {
        switch (char) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '"': return '&quot;';
          case "'": return '&#x27;';
          default: return char;
        }
      });
    } else {
      sanitizedValue = escapeHtml(attrValue);
    }
    
    sanitizedAttrs.push(`${attrName}="${sanitizedValue}"`);
  }
  
  return sanitizedAttrs.length > 0 ? ' ' + sanitizedAttrs.join(' ') : '';
}
