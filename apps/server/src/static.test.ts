import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inlineScriptHashes } from './static.js';

describe('inlineScriptHashes', () => {
  it('calcule l’empreinte des seuls scripts en ligne', () => {
    const inline = 'console.log(1)';
    const html = `<script src="/a.js"></script><script type="module">${inline}</script>`;
    const expected = createHash('sha256').update(inline).digest('base64');
    expect(inlineScriptHashes(html)).toEqual([`'sha256-${expected}'`]);
  });
});
